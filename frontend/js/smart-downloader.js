// js/smart-downloader.js - 智能分片下载模块
// 将大查询拆分为多个小查询，以适配免费 API 单次查询限制

import { state, SMART_DOWNLOAD_HARD_LIMIT, VIP_MONTHLY_DATA_QUOTA, VIP_LEVEL_MAP } from './config.js';
import { fetchStats, fetchSearchResults } from './api.js';
import { incrementApiCalls, getUsageStats, incrementDataCount } from './storage.js';
import { isTauri } from './tauri-bridge.js';
import { info as logInfo, warn as logWarn, error as logError } from './logger.js';

// ==================== 常量 ====================

/** 可用于分片的聚合字段 */
const PLANNABLE_FIELDS = ['asn', 'country', 'port', 'server', 'org'];

/** 用于结果去重的字段名 */
const DEDUP_KEY = 'link';

// ==================== 配额管理 ====================

/**
 * 获取当前用户的 VIP 等级
 * @returns {number} VIP 等级 (0-5)
 */
export function getVipLevel() {
    const info = state.userInfo;
    if (!info) return 0;
    if (info.isvip) {
        const level = info.vip_level || 0;
        return VIP_LEVEL_MAP[level] ? level : 5;
    }
    return 0;
}

/**
 * 获取当前等级的月度数据获取配额
 * @returns {number} 月度配额 (Infinity 表示无限制)
 */
export function getMonthlyQuota() {
    const level = getVipLevel();
    return VIP_MONTHLY_DATA_QUOTA[level] ?? VIP_MONTHLY_DATA_QUOTA[0];
}

/**
 * 获取当月已使用的数据获取量
 * @returns {number} 已用量
 */
export function getMonthlyUsed() {
    return getUsageStats().dataCount || 0;
}

/**
 * 获取当月剩余可用数据配额
 * @returns {number} 剩余量 (Infinity 表示无限制)
 */
export function getRemainingQuota() {
    const quota = getMonthlyQuota();
    if (quota === Infinity) return Infinity;
    return Math.max(0, quota - getMonthlyUsed());
}

/**
 * 获取本次智能下载的最大允许数据量
 * 取硬性上限、月度剩余配额、实际数据量的最小值
 * @param {number} dataSize - 查询匹配的总数据量
 * @returns {{ limit: number, reason: string }} 限制值和原因
 */
export function getMaxDownloadLimit(dataSize) {
    const remaining = getRemainingQuota();
    const hardLimit = SMART_DOWNLOAD_HARD_LIMIT;

    if (remaining === 0) {
        return { limit: 0, reason: '当月数据配额已用尽，请下月再试或升级账户' };
    }

    // 无月度限制的用户 (永久高级会员)
    if (remaining === Infinity) {
        const limit = Math.min(hardLimit, dataSize);
        return {
            limit,
            reason: limit === dataSize
                ? `全量下载 ${dataSize.toLocaleString()} 条`
                : `硬性上限 ${hardLimit.toLocaleString()} 条，实际 ${dataSize.toLocaleString()} 条`
        };
    }

    // 有月度限制的用户
    const limit = Math.min(hardLimit, remaining, dataSize);
    let reason = '';
    if (limit === dataSize) {
        reason = `全量下载 ${dataSize.toLocaleString()} 条`;
    } else if (limit === remaining) {
        reason = `当月剩余配额 ${remaining.toLocaleString()} 条，不足全量`;
    } else {
        reason = `硬性上限 ${hardLimit.toLocaleString()} 条`;
    }

    return { limit, reason };
}

// ==================== 免费查询限制 ====================

/**
 * 获取免费用户单次查询的最大结果数
 * @returns {number} 单次查询限制
 */
export function getFreeLimit() {
    const info = state.userInfo;
    if (info?.remain_api_data > 0) return info.remain_api_data;
    if (info?.maxsize > 0) return info.maxsize;
    return 10000;
}

// ==================== 查询大小估算 ====================

/**
 * 估算查询匹配的总结果数
 * @param {string} query - FOFA 查询语句
 * @returns {Promise<number>} 匹配总数，错误时返回 -1
 */
export async function estimateQuerySize(query) {
    logInfo('smartdl', '开始估算查询结果数量', { query });
    try {
        const result = await fetchStats(query, '');
        incrementApiCalls();
        if (result.error) {
            logWarn('smartdl', '估算查询结果数量失败（API 错误）', { query, errmsg: result.errmsg });
            return -1;
        }
        const size = result.size ?? -1;
        logInfo('smartdl', '查询结果数量估算完成', { query, size });
        return size;
    } catch (e) {
        logError('smartdl', '估算查询结果数量异常', { query, message: e.message || String(e) });
        return -1;
    }
}

// ==================== 维度分析 ====================

/**
 * 获取查询在各维度上的分布统计
 * @param {string} query - FOFA 查询语句
 * @returns {Promise<Object|null>} 统计数据对象（含 size、distinct、aggs），错误时返回 null
 */
export async function analyzeDimensions(query) {
    logInfo('smartdl', '开始分析查询维度分布', { query, fields: PLANNABLE_FIELDS.join(',') });
    try {
        const fields = PLANNABLE_FIELDS.join(',');
        const result = await fetchStats(query, fields);
        incrementApiCalls();
        if (result.error) {
            logWarn('smartdl', '维度分析失败（API 错误）', { query, errmsg: result.errmsg });
            return null;
        }
        const dimCount = result.aggs ? Object.keys(result.aggs).length : 0;
        logInfo('smartdl', '维度分析完成', { query, totalSize: result.size, dimensionCount: dimCount });
        return result;
    } catch (e) {
        logError('smartdl', '维度分析异常', { query, message: e.message || String(e) });
        return null;
    }
}

// ==================== 查询构建 ====================

/**
 * 将基础查询与条件数组组合为完整 FOFA 查询语句
 * 自动去重：如果 baseQuery 中已包含某字段的条件，不再重复添加
 * @param {string} baseQuery - 基础查询
 * @param {Array<{field: string, op: string, values: string[]}>} conditions - 条件数组
 * @returns {string} 组合后的查询语句
 */
export function buildQuery(baseQuery, conditions) {
    if (!conditions || conditions.length === 0) return baseQuery;

    // 检查 baseQuery 中已存在的字段条件，避免重复
    const existingFields = new Set();
    const fieldPattern = /(\w+)=/g;
    let match;
    while ((match = fieldPattern.exec(baseQuery)) !== null) {
        existingFields.add(match[1]);
    }

    const parts = conditions
        .filter(({ field }) => !existingFields.has(field))
        .map(({ field, op, values }) => {
            if (op === '=' && values.length === 1) {
                return `${field}="${values[0]}"`;
            }
            if (op === '=' && values.length > 1) {
                const orParts = values.map(v => `${field}="${v}"`);
                return `(${orParts.join(' || ')})`;
            }
            if (op === '!=') {
                // FOFA 不支持 !(field="A" || field="B") 语法
                // 正确写法: field!="A" && field!="B"
                return values.map(v => `${field}!="${v}"`).join(' && ');
            }
            // Fallback: treat as = with single value
            return `${field}="${values[0]}"`;
        });

    if (parts.length === 0) return baseQuery;
    return `${baseQuery} && ${parts.join(' && ')}`;
}

// ==================== 查询规划 ====================

/** 递归探测最大深度（避免无限链式打 API）
 * 深度 3 = 原始探测 + 最多 2 层子探测，适合高度集中的数据（如 cloud 资产 90%+ 同 ASN） */
const MAX_PROBE_DEPTH = 3;

/** 当某桶占总数比例超过此阈值时，认为比例估算不可信，需走递归探测 */
const PROBE_RATIO_THRESHOLD = 0.5;

/** trySubSplit 的最低覆盖率：若生成的步骤覆盖不到 entry 的此比例，认为拆分失败 */
const SUBSPLIT_MIN_COVERAGE = 0.5;

/**
 * 规划结果包装：包含步骤数组和元信息（探测次数、原始/目标量等）
 * @typedef {Object} PlanResult
 * @property {Array<Object>} steps - 扁平化后的查询步骤
 * @property {number} probeCount - 递归探测触发的 fetchStats 次数（同步规划时为 0）
 * @property {number} targetSize - 本次目标数据量（min(stats.size, maxTotalLimit)）
 * @property {number} coveredSize - 步骤估算总和
 */

/**
 * 同步规划：仅依据现有 stats 拆分，不发起额外 API 调用。
 * 用于简单情况（无超大桶或单维度即可切完）。
 *
 * 修复要点：
 * 1. 超大桶 trySubSplit 失败时不再静默丢弃，而是产出 needsProbe=true 的占位步骤
 * 2. 估算公式使用 originalSize（未被 maxTotalLimit 裁剪的真实总数）
 * 3. 桶占比 > PROBE_RATIO_THRESHOLD 时强制标记 needsProbe
 *
 * @param {string} baseQuery - 基础查询
 * @param {Object} stats - analyzeDimensions 返回的统计数据
 * @param {number} freeLimit - 单次查询限制
 * @param {number} [maxTotalLimit=SMART_DOWNLOAD_HARD_LIMIT] - 本次总上限
 * @returns {PlanResult} 规划结果（含 steps 与元信息）
 */
export function planQueries(baseQuery, stats, freeLimit, maxTotalLimit = SMART_DOWNLOAD_HARD_LIMIT) {
    // 原始总数（用于估算公式的分母，避免被裁剪污染）
    const originalSize = stats.size;
    // 实际可规划的数据量 = min(stats.size, maxTotalLimit)
    const planSize = Math.min(stats.size, maxTotalLimit);

    // Case 1: 总量在限制内，无需拆分
    if (planSize <= freeLimit) {
        const desc = planSize < stats.size
            ? `部分结果 (${planSize.toLocaleString()}/${stats.size.toLocaleString()} 条，受配额限制)`
            : `全部结果 (${planSize.toLocaleString()} 条)`;
        return {
            steps: [{
                id: 1,
                query: baseQuery,
                estimatedSize: planSize,
                description: desc,
                status: 'pending'
            }],
            probeCount: 0,
            targetSize: planSize,
            coveredSize: planSize
        };
    }

    // 构造规划用 stats：保留 originalSize 字段，避免污染估算
    const planStats = { ...stats, size: planSize, originalSize };

    // Case 2: 按单维度拆分
    // 字段选择策略：优先选「可直接成桶（无需探测）」数量最多的字段，
    // 避免选只有 1 个桶的维度（如 country=JP 全量）作主维度。
    // 排序键：smallBucketCount DESC, bucketCount DESC, total DESC
    const rankedFields = PLANNABLE_FIELDS
        .map(field => {
            const aggs = planStats.aggs?.[field] || [];
            const total = aggs.reduce((s, a) => s + a.count, 0);
            const smallBucketCount = aggs.filter(a => a.count <= freeLimit).length;
            return { field, aggs, total, bucketCount: aggs.length, smallBucketCount };
        })
        .filter(f => f.aggs.length > 0)
        .sort((a, b) =>
            b.smallBucketCount - a.smallBucketCount ||
            b.bucketCount - a.bucketCount ||
            b.total - a.total
        );

    for (const { field, aggs } of rankedFields) {
        const plan = trySplitByField(baseQuery, planStats, field, aggs, freeLimit);
        if (plan) {
            const coveredSize = plan.reduce((s, st) => s + st.estimatedSize, 0);
            return {
                steps: plan,
                probeCount: 0,
                targetSize: planSize,
                coveredSize
            };
        }
    }

    // Fallback: 返回单条查询（标记 needsProbe 让上层异步入口处理）
    const desc = planSize < stats.size
        ? `部分结果 (${planSize.toLocaleString()}/${stats.size.toLocaleString()} 条，受配额限制)`
        : `全部结果 (${planSize.toLocaleString()} 条，需探测)`;
    return {
        steps: [{
            id: 1,
            query: baseQuery,
            estimatedSize: planSize,
            description: desc,
            status: 'pending',
            needsProbe: true
        }],
        probeCount: 0,
        targetSize: planSize,
        coveredSize: planSize
    };
}

/**
 * 异步规划：在同步规划基础上，对 needsProbe 步骤发起递归探测。
 *
 * 探测规则：
 * - 仅当步骤标记 needsProbe=true 时触发
 * - 对子查询调用 fetchStats 获取真实分布，再用新 stats 重新切分
 * - 深度 ≤ MAX_PROBE_DEPTH；超过则保留原步骤并打 warning
 * - 探测失败（网络/API 错误）时降级，保留原步骤避免阻塞
 *
 * @param {string} baseQuery - 基础查询
 * @param {Object} stats - analyzeDimensions 返回的统计数据
 * @param {number} freeLimit - 单次查询限制
 * @param {number} [maxTotalLimit=SMART_DOWNLOAD_HARD_LIMIT] - 本次总上限
 * @param {Function} [onProgress] - 探测进度回调 ({ probed, total, query }) => void
 * @returns {Promise<PlanResult>} 规划结果
 */
export async function planQueriesAsync(baseQuery, stats, freeLimit, maxTotalLimit = SMART_DOWNLOAD_HARD_LIMIT, onProgress) {
    // 1. 先跑同步规划
    const syncResult = planQueries(baseQuery, stats, freeLimit, maxTotalLimit);

    // 2. 找出需要探测的步骤
    const probeSteps = syncResult.steps.filter(s => s.needsProbe);
    if (probeSteps.length === 0) {
        return syncResult;
    }

    // 3. 递归探测每个 needsProbe 步骤
    let probeCount = 0;
    const finalSteps = [];
    const remainingSteps = syncResult.steps.filter(s => !s.needsProbe);

    for (const probeStep of probeSteps) {
        if (onProgress) {
            onProgress({ probed: probeCount, total: probeSteps.length, query: probeStep.query });
        }

        const subResult = await probeAndSplit(probeStep.query, freeLimit, MAX_PROBE_DEPTH, stats.size);
        probeCount += subResult.probeCount;

        if (subResult.steps && subResult.steps.length > 0) {
            // 用探测结果替换原步骤；保留原描述前缀以便追溯
            const origDesc = probeStep.description || '';
            subResult.steps.forEach((s, idx) => {
                s.description = s.description || '';
                if (idx === 0 && origDesc) {
                    s.description = `${origDesc} → ${s.description}`;
                }
                finalSteps.push(s);
            });
        } else {
            // 探测失败/无结果，降级保留原步骤
            logWarn('smartdl', '探测失败，保留原步骤', { query: probeStep.query });
            finalSteps.push(probeStep);
        }
    }

    if (onProgress) {
        onProgress({ probed: probeCount, total: probeSteps.length, query: null });
    }

    // 合并 + 重排 id
    const allSteps = [...remainingSteps, ...finalSteps];
    reassignStepIds(allSteps);

    const coveredSize = allSteps.reduce((s, st) => s + st.estimatedSize, 0);
    return {
        steps: allSteps,
        probeCount,
        targetSize: syncResult.targetSize,
        coveredSize
    };
}

/**
 * 递归探测一个子查询：fetchStats → planQueries → 收集 needsProbe 子步骤 → 继续探测
 * @param {string} subQuery - 子查询语句
 * @param {number} freeLimit
 * @param {number} depth - 剩余探测深度
 * @param {number} [parentOriginalSize] - 父级原始总数（用于估算可信度判断）
 * @returns {Promise<{steps: Array, probeCount: number}>}
 */
async function probeAndSplit(subQuery, freeLimit, depth, parentOriginalSize) {
    if (depth <= 0) {
        // 达到深度上限，返回占位步骤（标记可能超限）
        return {
            steps: [{
                id: 0,
                query: subQuery,
                estimatedSize: parentOriginalSize || freeLimit,
                description: `(达到探测深度上限，可能超限)`,
                status: 'pending'
            }],
            probeCount: 0
        };
    }

    let subStats;
    try {
        const result = await fetchStats(subQuery, PLANNABLE_FIELDS.join(','));
        incrementApiCalls();
        if (result.error || !result.size) {
            logWarn('smartdl', '探测 fetchStats 返回错误', { subQuery, errmsg: result.errmsg });
            return { steps: [], probeCount: 1 };
        }
        subStats = result;
    } catch (e) {
        logError('smartdl', '探测 fetchStats 异常', { subQuery, message: e.message || String(e) });
        return { steps: [], probeCount: 1 };
    }

    // 用子查询的真实 stats 重新规划（maxTotalLimit 传 Infinity 让规划器用全部 size）
    const subPlan = planQueries(subQuery, subStats, freeLimit, Infinity);
    let probeCount = 1;

    const probeChildren = subPlan.steps.filter(s => s.needsProbe);
    if (probeChildren.length === 0) {
        return { steps: subPlan.steps, probeCount };
    }

    // 继续递归探测子步骤
    const finalSteps = [];
    const keepSteps = subPlan.steps.filter(s => !s.needsProbe);
    for (const child of probeChildren) {
        const childResult = await probeAndSplit(child.query, freeLimit, depth - 1, subStats.size);
        probeCount += childResult.probeCount;
        if (childResult.steps.length > 0) {
            finalSteps.push(...childResult.steps);
        } else {
            // 子探测失败，保留原步骤
            finalSteps.push(child);
        }
    }

    const allSubSteps = [...keepSteps, ...finalSteps];
    reassignStepIds(allSubSteps);
    return { steps: allSubSteps, probeCount };
}

/**
 * 重新分配步骤 id（顺序 1..N）
 * @param {Array<Object>} steps
 */
function reassignStepIds(steps) {
    steps.forEach((s, idx) => { s.id = idx + 1; });
}

/**
 * 尝试按单个字段拆分查询
 *
 * 关键修复：超大桶 trySubSplit 失败时不再静默丢弃，
 * 而是产出 needsProbe=true 的占位步骤，让异步规划器后续探测。
 *
 * @param {string} baseQuery
 * @param {Object} stats - 含 originalSize 的规划用 stats
 * @param {string} field
 * @param {Array} aggs - 该字段的聚合数据 [{count, name}, ...]
 * @param {number} freeLimit
 * @returns {Array<Object>|null} 计划步骤数组（可能含 needsProbe 步骤），无法拆分时返回 null
 */
function trySplitByField(baseQuery, stats, field, aggs, freeLimit) {
    const originalSize = stats.originalSize || stats.size;
    const steps = [];
    let stepId = 1;
    let coveredCount = 0;

    const usedValues = [];
    let i = 0;

    while (i < aggs.length) {
        const entry = aggs[i];

        if (entry.count <= freeLimit) {
            // 单个值即可容纳，尝试合并后续小值
            const batch = [entry.name];
            let batchCount = entry.count;
            let j = i + 1;

            while (j < aggs.length && batchCount + aggs[j].count <= freeLimit) {
                batch.push(aggs[j].name);
                batchCount += aggs[j].count;
                j++;
            }

            const query = buildQuery(baseQuery, [{ field, op: '=', values: batch }]);
            steps.push({
                id: stepId++,
                query,
                estimatedSize: batchCount,
                description: buildDescription(field, batch, batchCount),
                status: 'pending'
            });

            batch.forEach(v => usedValues.push(v));
            coveredCount += batchCount;
            i = j;
        } else {
            // 单个值超限，先尝试用现有次级维度拆分
            const subSplit = trySubSplit(baseQuery, field, entry, stats, freeLimit);

            // 判断是否需要探测：桶占比 > PROBE_RATIO_THRESHOLD 时比例估算不可信
            const bucketRatio = entry.count / originalSize;
            const needsProbeByRatio = bucketRatio > PROBE_RATIO_THRESHOLD;

            if (subSplit && !needsProbeByRatio) {
                subSplit.forEach(s => {
                    s.id = stepId++;
                    steps.push(s);
                });
                usedValues.push(entry.name);
                coveredCount += entry.count;
                i++;
            } else {
                // 关键修复：不静默丢弃，产出 needsProbe 占位步骤
                // 不计入 coveredCount，让"其他"逻辑知道这部分还未真正规划
                const query = buildQuery(baseQuery, [{ field, op: '=', values: [entry.name] }]);
                const probeReason = needsProbeByRatio
                    ? `超大桶占比 ${(bucketRatio * 100).toFixed(1)}%，比例估算不可信`
                    : `现有维度无法拆分`;
                steps.push({
                    id: stepId++,
                    query,
                    estimatedSize: entry.count,
                    description: `${field.toUpperCase()}: ${entry.name} (${entry.count.toLocaleString()} 条，待探测)`,
                    status: 'pending',
                    needsProbe: true,
                    probeReason
                });
                // 标记该值已处理（避免被"其他"重复计入），但不增加 coveredCount
                usedValues.push(entry.name);
                i++;
            }
        }
    }

    // 检查余量：不在 top 5 中的数据
    // 注意：超大桶的 entry.count 没有计入 coveredCount，所以 remaining 会包含它
    // 但我们已经为超大桶单独产出了 needsProbe 步骤，这里需要避免重复
    const topTotal = aggs.reduce((s, a) => s + a.count, 0);
    const realRemaining = Math.max(0, stats.size - topTotal);

    if (realRemaining > 0) {
        if (realRemaining <= freeLimit) {
            const query = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
            steps.push({
                id: stepId++,
                query,
                estimatedSize: realRemaining,
                description: `其他 ${field} (${realRemaining.toLocaleString()} 条)`,
                status: 'pending'
            });
        } else {
            // 余量超限，也标记 needsProbe
            const query = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
            steps.push({
                id: stepId++,
                query,
                estimatedSize: realRemaining,
                description: `其他 ${field} (${realRemaining.toLocaleString()} 条，待探测)`,
                status: 'pending',
                needsProbe: true
            });
        }
    }

    // 验证：所有非 needsProbe 步骤都必须在限制内
    // needsProbe 步骤会由异步规划器处理，这里跳过校验
    const nonProbeSteps = steps.filter(s => !s.needsProbe);
    const allUnderLimit = nonProbeSteps.every(s => s.estimatedSize <= freeLimit);
    if (!allUnderLimit) return null;

    return steps;
}

/**
 * 尝试对单个超限值添加次级维度进行拆分
 *
 * 修复：估算公式使用 originalSize（未被裁剪的真实总数），
 * 避免分母被 maxTotalLimit 污染导致双倍误差。
 *
 * @param {string} baseQuery
 * @param {string} primaryField - 主维度字段名
 * @param {Object} entry - {count, name}
 * @param {Object} stats - 完整统计数据（含 originalSize）
 * @param {number} freeLimit
 * @returns {Array<Object>|null} 子步骤数组，无法拆分时返回 null
 */
function trySubSplit(baseQuery, primaryField, entry, stats, freeLimit) {
    // 修复：用 originalSize 避免被裁剪污染
    const originalSize = stats.originalSize || stats.size;

    const secondaryField = PLANNABLE_FIELDS.find(f => f !== primaryField && stats.aggs?.[f]?.length > 0);
    if (!secondaryField) return null;

    const subAggs = stats.aggs[secondaryField];
    const steps = [];
    let coveredCount = 0;
    const usedValues = [];

    for (const subEntry of subAggs) {
        // 估算交叉计数：按比例分配（使用 originalSize 作为分母）
        const estimatedCrossCount = Math.ceil(entry.count * (subEntry.count / originalSize));
        if (estimatedCrossCount > freeLimit) continue;

        const query = buildQuery(baseQuery, [
            { field: primaryField, op: '=', values: [entry.name] },
            { field: secondaryField, op: '=', values: [subEntry.name] }
        ]);
        steps.push({
            id: 0,
            query,
            estimatedSize: estimatedCrossCount,
            description: `${primaryField}=${entry.name} & ${secondaryField}=${subEntry.name} (~${estimatedCrossCount.toLocaleString()})`,
            status: 'pending'
        });
        usedValues.push(subEntry.name);
        coveredCount += estimatedCrossCount;
    }

    // 余量
    const remaining = entry.count - coveredCount;
    if (remaining > 0 && remaining <= freeLimit && usedValues.length > 0) {
        const query = buildQuery(baseQuery, [
            { field: primaryField, op: '=', values: [entry.name] },
            { field: secondaryField, op: '!=', values: usedValues }
        ]);
        steps.push({
            id: 0,
            query,
            estimatedSize: remaining,
            description: `${primaryField}=${entry.name} & 其他 ${secondaryField} (~${remaining.toLocaleString()})`,
            status: 'pending'
        });
    }

    if (steps.length === 0) return null;
    const allUnderLimit = steps.every(s => s.estimatedSize <= freeLimit);
    if (!allUnderLimit) return null;

    // 覆盖率检查：次级维度 top 桶本身超限被 skip 时，会留下大量未覆盖部分。
    // 此时比例估算已不可信（独立分布假设失败），返回 null 让上层走递归探测。
    const coverageRatio = coveredCount / entry.count;
    if (coverageRatio < SUBSPLIT_MIN_COVERAGE) {
        return null;
    }

    return steps;
}

/**
 * 构建人类可读的步骤描述
 * @param {string} field
 * @param {string[]} values
 * @param {number} count
 * @returns {string}
 */
function buildDescription(field, values, count) {
    const label = field.toUpperCase();
    if (values.length === 1) {
        return `${label}: ${values[0]} (${count.toLocaleString()} 条)`;
    }
    return `${label}: ${values.join(', ')} (${count.toLocaleString()} 条)`;
}

// ==================== 计划执行 ====================

/** 步骤间延迟（毫秒），防止触发 FOFA 限流 */
export const STEP_DELAY_MS = 2000;

/** 单步最大重试次数 */
export const MAX_RETRIES = 3;

/** 单次请求超时（毫秒） — 大查询可能较慢，给 60 秒 */
export const REQUEST_TIMEOUT_MS = 60000;

/**
 * 延迟指定时间
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 执行单个步骤（带重试和超时）
 * @param {Object} step - 计划步骤
 * @param {string} selectedFields - 字段列表
 * @param {number} freeLimit - 单次限制
 * @param {Function} onProgress - 进度回调
 * @param {Array} allResults - 结果收集数组
 * @param {number} stepIndex - 当前步骤索引（用于日志）
 * @param {number} totalSteps - 总步骤数
 */
async function executeStep(step, selectedFields, freeLimit, onProgress, allResults, stepIndex, totalSteps) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        step.status = 'running';
        step.retryCount = attempt;
        if (onProgress) onProgress();

        try {
            // 始终请求 freeLimit：估算值可能偏低导致丢数据，
            // 而 FOFA 在数据不足时只返回实际数量，不会报错
            const result = await fetchSearchResults(
                step.query, 1, freeLimit, selectedFields,
                false, REQUEST_TIMEOUT_MS
            );
            incrementApiCalls();

            if (result.error) {
                // 解析详细的错误信息
                const errDetail = {
                    msg: result.errmsg || 'API 返回错误',
                    code: result.errcode,
                    size: result.size,
                    consumed: result.consumed_fpoint,
                    required: result.required_fpoints
                };
                lastError = errDetail.msg;
                if (errDetail.code) lastError += ` (code: ${errDetail.code})`;

                logWarn('smartdl', `步骤 ${stepIndex + 1}/${totalSteps} 第 ${attempt} 次尝试 API 错误`, { query: step.query, errDetail, attempt, maxRetries: MAX_RETRIES });

                if (attempt < MAX_RETRIES) {
                    const backoffMs = attempt * 2000; // 2s, 4s, 6s
                    step.errorMsg = `重试中 (${attempt}/${MAX_RETRIES}): ${lastError}`;
                    if (onProgress) onProgress();
                    await sleep(backoffMs);
                    continue;
                }
            } else {
                // 成功
                step.results = result.results || [];
                step.status = 'done';
                step.retryCount = undefined;
                allResults.push(step.results);
                logInfo('smartdl', `步骤 ${stepIndex + 1}/${totalSteps} 完成`, { query: step.query, resultCount: step.results.length, attempt });
                return;
            }
        } catch (err) {
            lastError = err.name === 'AbortError'
                ? `请求超时 (${REQUEST_TIMEOUT_MS / 1000}s)`
                : (err.message || '网络错误');
            logWarn('smartdl', `步骤 ${stepIndex + 1}/${totalSteps} 第 ${attempt} 次尝试网络错误`, { query: step.query, error: lastError, attempt, maxRetries: MAX_RETRIES });

            if (attempt < MAX_RETRIES) {
                const backoffMs = attempt * 2000;
                step.errorMsg = `重试中 (${attempt}/${MAX_RETRIES})...`;
                if (onProgress) onProgress();
                await sleep(backoffMs);
                continue;
            }
        }
    }

    // 所有重试均失败
    step.errorMsg = lastError || '请求失败';
    step.retryCount = undefined;
    logError('smartdl', `步骤 ${stepIndex + 1}/${totalSteps} 失败（已重试 ${MAX_RETRIES} 次）`, { query: step.query, error: step.errorMsg });
}

/**
 * 执行查询计划，获取并合并所有结果
 * @param {string} baseQuery - 基础查询（用于日志）
 * @param {Array<Object>} planSteps - planQueries 返回的计划步骤
 * @param {string} selectedFields - 逗号分隔的字段列表
 * @param {Function} onProgress - 进度回调 (planSteps) => void
 * @returns {Promise<{mergedResults: Array, stats: Object}>}
 */
export async function executePlan(baseQuery, planSteps, selectedFields, onProgress) {
    const freeLimit = getFreeLimit();

    logInfo('smartdl', '开始执行查询计划', { baseQuery, totalSteps: planSteps.length, pendingSteps: planSteps.filter(s => s.status === 'pending').length, freeLimit, selectedFields });

    // 确保 selectedFields 包含 dedup key
    const fieldsArr = selectedFields.split(',').map(f => f.trim());
    if (!fieldsArr.includes(DEDUP_KEY)) {
        fieldsArr.push(DEDUP_KEY);
        selectedFields = fieldsArr.join(',');
    }
    const dedupFieldIndex = fieldsArr.indexOf(DEDUP_KEY);

    const allResults = [];
    const pendingSteps = planSteps.filter(s => s.status === 'pending');
    const totalSteps = pendingSteps.length;

    for (let i = 0; i < pendingSteps.length; i++) {
        const step = pendingSteps[i];

        // 步骤间延迟（第一个步骤不需要延迟）
        if (i > 0) {
            await sleep(STEP_DELAY_MS);
        }

        await executeStep(step, selectedFields, freeLimit, () => onProgress(planSteps), allResults, i, totalSteps);

        // 实时回调
        onProgress(planSteps);
    }

    // 合并去重
    const mergedResults = await mergeAndDedup(allResults, dedupFieldIndex);

    const stepsCompleted = planSteps.filter(s => s.status === 'done').length;
    const stepsFailed = planSteps.filter(s => s.status === 'error').length;
    const totalFetched = allResults.reduce((sum, r) => sum + r.length, 0);

    // 记录当月数据获取量
    if (mergedResults.length > 0) {
        incrementDataCount(mergedResults.length);
    }

    logInfo('smartdl', '查询计划执行完成', {
        baseQuery,
        totalFetched,
        uniqueCount: mergedResults.length,
        duplicateCount: totalFetched - mergedResults.length,
        stepsCompleted,
        stepsFailed,
        stepsTotal: planSteps.length
    });

    return {
        mergedResults,
        stats: {
            totalFetched,
            uniqueCount: mergedResults.length,
            duplicateCount: totalFetched - mergedResults.length,
            stepsCompleted,
            stepsTotal: planSteps.length
        }
    };
}

// ==================== 合并去重 ====================

/**
 * 合并多个结果数组并按指定字段去重
 * 优先使用 Rust Tauri Command 进行高性能去重，降级到 JS 实现
 * @param {Array<Array>} allResults - 结果数组的数组
 * @param {number} dedupFieldIndex - 去重字段在行中的列索引
 * @returns {Promise<Array>} 去重后的结果数组
 */
export async function mergeAndDedup(allResults, dedupFieldIndex) {
    // Tauri 模式：使用 Rust 高性能去重
    if (isTauri()) {
        try {
            const result = await window.__TAURI_INTERNALS__.invoke('dedup_results', {
                batches: allResults,
                dedupKeyIndex: dedupFieldIndex
            });
            logInfo('smartdl', 'Rust 去重完成', { batchCount: allResults.length, resultCount: result.rows?.length });
            return result.rows;
        } catch (e) {
            logWarn('smartdl', 'Rust 去重失败，降级到 JS 实现', { message: e.message || String(e), batchCount: allResults.length });
        }
    }

    // 降级：JS 实现
    const seen = new Map();
    const merged = [];

    for (const batch of allResults) {
        for (const row of batch) {
            const key = row[dedupFieldIndex];
            if (key == null || seen.has(key)) continue;
            seen.set(key, true);
            merged.push(row);
        }
    }

    return merged;
}
