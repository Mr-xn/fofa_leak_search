// js/smart-downloader.js - 智能分片下载模块
// 将大查询拆分为多个小查询，以适配免费 API 单次查询限制

import { state, SMART_DOWNLOAD_HARD_LIMIT, VIP_MONTHLY_DATA_QUOTA, VIP_LEVEL_MAP } from './config.js';
import { fetchStats, fetchSearchResults, fetchSearchSize } from './api.js';
import { incrementApiCalls, getUsageStats, incrementDataCount } from './storage.js';
import { isTauri } from './tauri-bridge.js';
import { info as logInfo, warn as logWarn, error as logError } from './logger.js';
import { showConfirm } from './utils.js';

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
    // 支持 =、!=、== 三种条件（捕获字段名）
    const existingFields = new Set();
    const fieldPattern = /(\w+)(?:!=|==|=)/g;
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

/** 探测调用前/间的延迟（毫秒）
 * FOFA stats 接口对单 Key 限速约 1 次/秒（errmsg [45012] 请求速度过快 / HTTP 429）
 * 留 1.5s 余量，确保不触发速率限制 */
const PROBE_DELAY_MS = 1500;

/** 探测调用最大重试次数（仅对 429/45012 限流重试，其他错误直接放弃） */
const PROBE_MAX_RETRIES = 3;

/** 限流自适应：延迟下限（毫秒）— 连续成功后最低压缩到此值 */
const RATE_LIMIT_MIN_DELAY_MS = 800;

/** 限流自适应：延迟上限（毫秒）— 连续 429 后最高拉长到此值 */
const RATE_LIMIT_MAX_DELAY_MS = 10000;

/** 预查阶段：估算偏低超过此倍数时标记 deviation 告警 */
const DEVIATION_WARN_RATIO = 1.5;

/** 二分拆分最大递归深度（避免无限递归） */
const MAX_BISECTION_DEPTH = 3;

/** 限流自适应状态（模块级单例，跨多次 planQueriesAsync 调用持久；export 供 UI 读取） */
export const rateLimitState = {
    consecutive429: 0,   // 连续 429 次数
    total429: 0,         // 累计 429 次数
    totalCalls: 0,       // 累计调用次数
    currentDelayMs: 1500 // 当前动态延迟
};

/**
 * 记录一次 API 调用的限流结果，动态调整下次调用的延迟
 * - 收到 429 → consecutive429++，currentDelayMs × 1.5（上限 10s）
 * - 成功 → consecutive429=0；每 5 次连续成功 currentDelayMs × 0.8（下限 800ms）
 * @param {boolean} was429 - 是否触发了限流
 */
function recordRateLimitOutcome(was429) {
    rateLimitState.totalCalls++;
    if (was429) {
        rateLimitState.consecutive429++;
        rateLimitState.total429++;
        rateLimitState.currentDelayMs = Math.min(
            RATE_LIMIT_MAX_DELAY_MS,
            Math.round(rateLimitState.currentDelayMs * 1.5)
        );
    } else {
        rateLimitState.consecutive429 = 0;
        if (rateLimitState.totalCalls % 5 === 0) {
            rateLimitState.currentDelayMs = Math.max(
                RATE_LIMIT_MIN_DELAY_MS,
                Math.round(rateLimitState.currentDelayMs * 0.8)
            );
        }
    }
}

/**
 * 重置限流自适应状态到初始值
 *
 * 用于「开始分析」入口（startSmartDownload）做会话级重置：
 * 用户上次会话的 429 历史不应让本次新查询付出过长的延迟。
 * 跨多次 planQueriesAsync 调用持久的是同一会话内的累积；新会话应清零。
 *
 * 注意：total429/totalCalls 是诊断指标，重置后丢失历史；如有需要可改为只重置 currentDelayMs。
 */
export function resetRateLimitState() {
    rateLimitState.consecutive429 = 0;
    rateLimitState.total429 = 0;
    rateLimitState.totalCalls = 0;
    rateLimitState.currentDelayMs = 1500;
}

/** 检测响应是否为 FOFA 限流错误（errmsg 或 HTTP 状态） */
function isRateLimitError(errmsg, httpStatus) {
    if (httpStatus === 429) return true;
    if (!errmsg) return false;
    return errmsg.includes('45012') || errmsg.includes('请求速度过快');
}

/**
 * 预查专用 fetchSearchSize 包装：带限流自适应延迟 + 限流重试
 *
 * - 调用前 sleep(rateLimitState.currentDelayMs)
 * - 收到 429 → 指数退避重试（复用 rateLimitState.currentDelayMs，最多 PROBE_MAX_RETRIES 次）
 * - 成功 → 返回结果；彻底失败 → 返回 null
 *
 * @param {string} query
 * @returns {Promise<{size, error, errmsg, consumedFpoint}|null>}
 */
async function fetchSearchSizeForProbe(query) {
    await sleep(rateLimitState.currentDelayMs);

    for (let attempt = 1; attempt <= PROBE_MAX_RETRIES; attempt++) {
        try {
            const result = await fetchSearchSize(query);
            incrementApiCalls();

            if (result.error && isRateLimitError(result.errmsg)) {
                recordRateLimitOutcome(true);
                if (attempt < PROBE_MAX_RETRIES) {
                    logWarn('smartdl', '预查触发限流，退避重试', {
                        query, errmsg: result.errmsg, attempt,
                        nextDelay: rateLimitState.currentDelayMs
                    });
                    await sleep(rateLimitState.currentDelayMs);
                    continue;
                }
                logWarn('smartdl', '预查限流重试耗尽', { query, errmsg: result.errmsg, attempts: attempt });
                return null;
            }

            recordRateLimitOutcome(false);
            if (attempt > 1) {
                logInfo('smartdl', '预查重试成功', { query, attempt });
            }
            return result;
        } catch (e) {
            recordRateLimitOutcome(true);
            if (attempt < PROBE_MAX_RETRIES) {
                logWarn('smartdl', '预查网络异常，退避重试', {
                    query, error: e.message || String(e), attempt,
                    nextDelay: rateLimitState.currentDelayMs
                });
                await sleep(rateLimitState.currentDelayMs);
                continue;
            }
            logError('smartdl', '预查异常重试耗尽', { query, error: e.message || String(e), attempts: attempt });
            return null;
        }
    }
    return null;
}

/** 检测 FOFA 限流错误（errmsg 或 HTTP status）*/
function isRateLimited(errmsg, httpStatus) {
    if (httpStatus === 429) return true;
    if (!errmsg) return false;
    // FOFA 错误码 45012 = 请求速度过快，45011 = 月度配额耗尽（不重试）
    return errmsg.includes('45012') || errmsg.includes('请求速度过快');
}

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
            // 探测失败/无结果 → 降级到笛卡尔积切分（用原始 stats 的其他维度组合）
            logWarn('smartdl', '探测失败，尝试笛卡尔积降级', { query: probeStep.query });
            const cartesianSteps = cartesianSplit(probeStep, stats, freeLimit);

            if (cartesianSteps && cartesianSteps.length > 0) {
                // 笛卡尔积切分成功，标记为估算（让 UI 知道这些数字是估算的）
                const origDesc = probeStep.description || '';
                cartesianSteps.forEach((s, idx) => {
                    s.estimated = true;
                    if (idx === 0 && origDesc) {
                        s.description = `${origDesc} → ${s.description}`;
                    }
                    finalSteps.push(s);
                });
                logInfo('smartdl', '笛卡尔积降级成功', {
                    query: probeStep.query,
                    stepCount: cartesianSteps.length,
                    covered: cartesianSteps.reduce((s, st) => s + st.estimatedSize, 0)
                });
            } else {
                // 笛卡尔积也切不动，最后才标记 probeFailed
                logWarn('smartdl', '笛卡尔积降级失败，标记 probeFailed', { query: probeStep.query });
                probeStep.probeFailed = true;
                probeStep.needsProbe = false;
                probeStep.description = `${probeStep.description} ⚠ 探测失败，此步可能超限`;
                finalSteps.push(probeStep);
            }
        }
    }

    if (onProgress) {
        onProgress({ probed: probeCount, total: probeSteps.length, query: null });
    }

    // 合并 + 重排 id
    const allSteps = [...remainingSteps, ...finalSteps];
    reassignStepIds(allSteps);

    // 覆盖量只统计真正切好的步骤（probeFailed 步骤的 estimatedSize 不可信）
    // estimated 步骤（笛卡尔积降级产物）的 estimatedSize 是估算值，但仍是有效切分
    const coveredSize = allSteps
        .filter(s => !s.probeFailed)
        .reduce((s, st) => s + st.estimatedSize, 0);
    return {
        steps: allSteps,
        probeCount,
        targetSize: syncResult.targetSize,
        coveredSize
    };
}

/** 笛卡尔积降级最大维度深度（避免组合爆炸） */
const CARTESIAN_MAX_DEPTH = 4;

/**
 * 笛卡尔积降级：探测失败时，用原始 stats 的其他维度组合切分超大桶
 *
 * 场景：asn=16509 占 94%，探测 fetchStats 被 429 限流拿不到真实子分布。
 * 此时直接用原始 top-5 stats 做笛卡尔积切分（port → server → org → ... 任意深度）。
 *
 * 实测验证（用户案例 app="WordPress" JP cloud）：
 * 原始 top-5 估算与真实子查询误差 <5%，足够可信。
 *
 * 算法（递归）：
 * 1. 从 stats.aggs 选一个未使用的维度（按分散度排序）
 * 2. 对该维度的每个 top 桶估算大小（ratio × probeSize）
 * 3. 桶 ≤freeLimit → 直接产出步骤
 *    桶 >freeLimit → 递归用下一个维度切（直到 CARTESIAN_MAX_DEPTH）
 * 4. 最后用 != 兜底"其他"部分
 *
 * @param {Object} probeStep - needsProbe 步骤（含 query 和 estimatedSize）
 * @param {Object} stats - 原始 analyzeDimensions 返回的统计数据
 * @param {number} freeLimit
 * @returns {Array<Object>|null} 步骤数组，无法切分时返回 null
 */
function cartesianSplit(probeStep, stats, freeLimit) {
    if (!probeStep || !probeStep.query || !stats?.aggs) return null;
    const probeSize = probeStep.estimatedSize;
    if (!probeSize || probeSize <= freeLimit) return null;

    // 从 query 解析已使用的字段（支持 =、!=、== 三种条件）
    const usedFields = new Set();
    const fieldPattern = /(\w+)\s*(?:!=|==|=)/g;
    let m;
    while ((m = fieldPattern.exec(probeStep.query)) !== null) {
        usedFields.add(m[1]);
    }

    // 候选维度：排除已用、桶数<2 的，按 top 桶占比升序（更分散的优先）
    const candidates = PLANNABLE_FIELDS
        .filter(f => !usedFields.has(f))
        .map(field => {
            const aggs = stats.aggs[field] || [];
            return {
                field,
                buckets: aggs.map(a => ({
                    name: a.name,
                    ratio: a.count / stats.size,
                    count: a.count
                })),
                topRatio: aggs.length > 0 ? Math.max(...aggs.map(a => a.count / stats.size)) : 1
            };
        })
        .filter(c => c.buckets.length >= 2)
        .sort((a, b) => a.topRatio - b.topRatio);

    if (candidates.length === 0) return null;

    // 递归切分
    const steps = [];
    const covered = cartesianRecursive(
        probeStep.query, probeSize, candidates, 0, freeLimit, steps, []
    );

    if (steps.length === 0) return null;

    // 覆盖率门槛：≥80% 才认为降级成功
    if (covered < probeSize * 0.8) {
        logWarn('smartdl', '笛卡尔积覆盖率不足', {
            query: probeStep.query, covered, probeSize,
            coverage: (covered / probeSize * 100).toFixed(1) + '%',
            stepCount: steps.length
        });
        return null;
    }

    reassignStepIds(steps);
    return steps;
}

/**
 * 笛卡尔积递归核心
 *
 * @param {string} query - 当前累积的查询语句
 * @param {number} estSize - 当前 query 的估算匹配数
 * @param {Array} candidates - 候选维度数组（已排序）
 * @param {number} depth - 当前递归深度
 * @param {number} freeLimit
 * @param {Array} outSteps - 输出步骤数组（会被本函数填充）
 * @param {Array<string>} condTrail - 条件轨迹，用于生成描述（如 ['port=80','server=Apache']）
 * @returns {number} 本次调用产出的步骤覆盖总数
 */
function cartesianRecursive(query, estSize, candidates, depth, freeLimit, outSteps, condTrail) {
    if (estSize <= freeLimit) {
        // 已可容纳，产出步骤
        const trailStr = condTrail.length > 0 ? condTrail.join(' & ') : '(全集)';
        outSteps.push({
            id: 0,
            query,
            estimatedSize: estSize,
            description: `${trailStr} (~${estSize.toLocaleString()}, 估算)`,
            status: 'pending'
        });
        return estSize;
    }

    // 已用完所有候选维度或达到深度上限：无法继续切
    if (depth >= CARTESIAN_MAX_DEPTH || depth >= candidates.length) {
        logWarn('smartdl', '笛卡尔积达到深度上限，跳过此桶', {
            query, estSize, depth, condTrail
        });
        return 0;
    }

    const dim = candidates[depth];
    let covered = 0;
    const usedValues = [];

    for (const bucket of dim.buckets) {
        const subEstSize = Math.ceil(estSize * bucket.ratio);
        const subQuery = buildQuery(query, [{ field: dim.field, op: '=', values: [bucket.name] }]);
        const subTrail = [...condTrail, `${dim.field}=${bucket.name}`];

        covered += cartesianRecursive(
            subQuery, subEstSize, candidates, depth + 1, freeLimit, outSteps, subTrail
        );
        usedValues.push(bucket.name);
    }

    // "其他" 兜底：top-5 之外的桶
    const otherSize = estSize - covered;
    if (otherSize > 0) {
        if (otherSize <= freeLimit) {
            const otherQuery = buildQuery(query, [{ field: dim.field, op: '!=', values: usedValues }]);
            const trailStr = [...condTrail, `其他${dim.field}`].join(' & ');
            outSteps.push({
                id: 0,
                query: otherQuery,
                estimatedSize: otherSize,
                description: `${trailStr} (~${otherSize.toLocaleString()}, 估算)`,
                status: 'pending'
            });
            covered += otherSize;
        } else {
            // "其他"也超限，递归用下一个维度切
            const otherQuery = buildQuery(query, [{ field: dim.field, op: '!=', values: usedValues }]);
            covered += cartesianRecursive(
                otherQuery, otherSize, candidates, depth + 1, freeLimit, outSteps,
                [...condTrail, `其他${dim.field}`]
            );
        }
    }

    return covered;
}

/**
 * 带延迟和限流重试的 fetchStats 封装（专用于探测路径）
 *
 * FOFA /api/search/stats 接口对单 Key 限速约 1 次/秒（errmsg [45012] / HTTP 429）。
 * 维度分析 → 探测 → 子探测 链路会连续打 stats，必须显式间隔 + 429 退避。
 *
 * 行为：
 * - 调用前 sleep PROBE_DELAY_MS（首次除外，由 caller 在维度分析后显式等待）
 * - 收到 429/45012 → 指数退避重试（1.5s, 3s），共发起 PROBE_MAX_RETRIES 次请求
 *   （最后一次失败不再退避，直接返回 null）
 * - 其他错误（401、45011 配额耗尽等）→ 直接放弃，不重试
 * - 成功 → 返回 stats 对象；彻底失败 → 返回 null
 *
 * @param {string} query - 查询语句
 * @param {boolean} [isFirstCall=false] - 是否首次调用（首次跳过前置延迟）
 * @returns {Promise<Object|null>} stats 对象，失败时返回 null
 */
async function fetchStatsForProbe(query, isFirstCall = false) {
    if (!isFirstCall) {
        await sleep(rateLimitState.currentDelayMs);
    }

    for (let attempt = 1; attempt <= PROBE_MAX_RETRIES; attempt++) {
        try {
            const result = await fetchStats(query, PLANNABLE_FIELDS.join(','));
            incrementApiCalls();

            if (result.error) {
                // FOFA 业务错误：区分限流 vs 其他
                if (isRateLimited(result.errmsg)) {
                    recordRateLimitOutcome(true);
                    if (attempt < PROBE_MAX_RETRIES) {
                        const backoffMs = attempt * PROBE_DELAY_MS; // attempt=1 → 1.5s, attempt=2 → 3s
                        logWarn('smartdl', `探测触发 FOFA 限流，退避重试`, {
                            query, errmsg: result.errmsg, attempt, backoffMs
                        });
                        await sleep(backoffMs);
                        continue;
                    }
                    logWarn('smartdl', '探测 fetchStats 限流重试耗尽', {
                        query, errmsg: result.errmsg, attempts: attempt
                    });
                    return null;
                }
                // 非限流错误（401/45011 等），不重试
                logWarn('smartdl', '探测 fetchStats 返回错误（非限流，不重试）', {
                    query, errmsg: result.errmsg
                });
                return null;
            }

            if (!result.size) {
                logWarn('smartdl', '探测 fetchStats 返回空 size', { query, size: result.size });
                return null;
            }

            if (attempt > 1) {
                logInfo('smartdl', '探测 fetchStats 重试成功', { query, attempt });
            }
            recordRateLimitOutcome(false);
            return result;
        } catch (e) {
            // 网络异常/超时：不区分原因，统一按指数退避重试
            if (attempt < PROBE_MAX_RETRIES) {
                const backoffMs = attempt * PROBE_DELAY_MS;
                logWarn('smartdl', `探测 fetchStats 网络异常，退避重试`, {
                    query, error: e.message || String(e), attempt, backoffMs
                });
                await sleep(backoffMs);
                continue;
            }
            logError('smartdl', '探测 fetchStats 异常（重试耗尽）', {
                query, message: e.message || String(e), attempts: attempt
            });
            return null;
        }
    }
    return null;
}

/**
 * 二分拆分超限步骤：用笛卡尔积下一个未用维度切分
 *
 * 策略：从 step.query 解析已用字段，选一个未用、桶数≥2、top 桶占比<90% 的维度，
 * 按 top-5 桶切分。每个子桶递归预查，仍超限则继续用下一个维度切。
 * 最后用 != 兜底"其他"部分。
 *
 * @param {Object} step - 待拆分步骤（query + estimatedSize + description）
 * @param {number} realSize - 真实匹配数（来自预查）
 * @param {number} maxsize - 单次查询上限（getMaxSize()）
 * @param {Object} originalStats - analyzeDimensions 返回的原始 stats
 * @param {number} depth - 当前递归深度（0=顶层）
 * @returns {Promise<Array|null>} 拆分后的步骤数组；无法拆分时返回 null
 */
async function bisectOverLimitStep(step, realSize, maxsize, originalStats, depth) {
    if (depth >= MAX_BISECTION_DEPTH) {
        logWarn('smartdl', '二分拆分达到深度上限', { query: step.query, realSize, depth });
        return null;
    }

    // 从 query 解析已用字段（支持 =、!=、== 三种条件）
    const usedFields = new Set();
    const fieldPattern = /(\w+)\s*(?:!=|==|=)/g;
    let m;
    while ((m = fieldPattern.exec(step.query)) !== null) {
        usedFields.add(m[1]);
    }

    // 候选维度：未用、桶数≥2、top 桶占比<90%（避免再选单桶占 90%+ 的）
    const candidates = PLANNABLE_FIELDS
        .filter(f => !usedFields.has(f))
        .map(f => {
            const buckets = originalStats.aggs?.[f] || [];
            const topRatio = buckets.length > 0
                ? Math.max(...buckets.map(b => b.count / originalStats.size))
                : 1;
            return { field: f, buckets, topRatio };
        })
        .filter(c => c.buckets.length >= 2 && c.topRatio < 0.9)
        .sort((a, b) => a.topRatio - b.topRatio);

    if (candidates.length === 0) {
        logWarn('smartdl', '二分拆分无可用维度', {
            query: step.query, usedFields: [...usedFields]
        });
        return null;
    }

    const nextDim = candidates[0];
    const subSteps = [];
    const usedValues = [];

    for (const bucket of nextDim.buckets) {
        const subQuery = buildQuery(step.query, [
            { field: nextDim.field, op: '=', values: [bucket.name] }
        ]);

        const subProbe = await fetchSearchSizeForProbe(subQuery);
        if (!subProbe || subProbe.error || !subProbe.size) {
            // 子桶预查失败，跳过（由 != 兜底覆盖）
            continue;
        }

        const subStep = {
            id: 0, // reassignStepIds 会重排
            query: subQuery,
            estimatedSize: subProbe.size,
            realSize: subProbe.size,
            description: `${step.description} & ${nextDim.field}=${bucket.name} (预查 ${subProbe.size.toLocaleString()})`,
            status: 'pending'
        };

        if (subProbe.size > maxsize) {
            // 子桶仍超限，递归拆分
            const deeper = await bisectOverLimitStep(
                subStep, subProbe.size, maxsize, originalStats, depth + 1
            );
            if (deeper && deeper.length > 0) {
                subSteps.push(...deeper);
            } else {
                // 递归也拆不动，标记 overLimit（执行时会触发 F 点检查）
                subStep.overLimit = true;
                subStep.description += ' ⚠ 仍超限';
                subSteps.push(subStep);
            }
        } else {
            subSteps.push(subStep);
        }
        usedValues.push(bucket.name);
    }

    // "其他" 兜底
    if (usedValues.length > 0) {
        const otherQuery = buildQuery(step.query, [
            { field: nextDim.field, op: '!=', values: usedValues }
        ]);
        const otherProbe = await fetchSearchSizeForProbe(otherQuery);
        if (otherProbe && !otherProbe.error && otherProbe.size > 0) {
            if (otherProbe.size <= maxsize) {
                subSteps.push({
                    id: 0,
                    query: otherQuery,
                    estimatedSize: otherProbe.size,
                    realSize: otherProbe.size,
                    description: `${step.description} & 其他${nextDim.field} (预查 ${otherProbe.size.toLocaleString()})`,
                    status: 'pending'
                });
            } else {
                // "其他"也超限，递归拆分
                const otherStep = {
                    id: 0, query: otherQuery, estimatedSize: otherProbe.size,
                    description: `${step.description} & 其他${nextDim.field}`, status: 'pending'
                };
                const deeper = await bisectOverLimitStep(
                    otherStep, otherProbe.size, maxsize, originalStats, depth + 1
                );
                if (deeper && deeper.length > 0) {
                    subSteps.push(...deeper);
                } else {
                    otherStep.overLimit = true;
                    subSteps.push(otherStep);
                }
            }
        }
    }

    if (subSteps.length === 0) return null;
    reassignStepIds(subSteps);
    return subSteps;
}

/**
 * 预查所有步骤的真实匹配数，超限的步骤二分拆分
 *
 * 流程：
 * 1. 对每个 step 调用 fetchSearchSizeForProbe 拿 realSize
 * 2. realSize > maxsize → bisectOverLimitStep 二分拆分
 * 3. 估算偏低（realSize > estimatedSize × DEVIATION_WARN_RATIO）→ 标记 deviation
 * 4. 预查失败 → 保留原步骤 + prefetchFailed 标记
 *
 * @param {Array<Object>} steps - planQueriesAsync 返回的步骤数组
 * @param {number} maxsize - 账户单次查询上限（getMaxSize()）
 * @param {Object} originalStats - 原始 analyzeDimensions 返回的 stats
 * @param {Function} [onProgress] - 进度回调 ({ checked, total, deviations, splits }) => void
 * @returns {Promise<Array<Object>>} 预查后的步骤数组（可能比输入长）
 */
export async function prefetchStepSizes(steps, maxsize, originalStats, onProgress) {
    const result = [];
    let deviations = 0;
    let splits = 0;
    let failed = 0;
    const total = steps.length;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const checked = i + 1;

        const probeResult = await fetchSearchSizeForProbe(step.query);

        if (!probeResult || probeResult.error || !probeResult.size) {
            // 预查失败：保留原步骤 + 标记
            step.prefetchFailed = true;
            step.description = `${step.description} ⚠ 预查失败`;
            result.push(step);
            failed++;
        } else {
            const realSize = probeResult.size;
            step.realSize = realSize;

            // 偏差检测（仅在 estimatedSize 存在且 > 0 时）
            if (step.estimatedSize > 0) {
                const ratio = realSize / step.estimatedSize;
                if (ratio > DEVIATION_WARN_RATIO) {
                    step.deviation = ratio;
                    deviations++;
                }
            }

            if (realSize > maxsize) {
                // 超限 → 二分拆分
                logInfo('smartdl', `步骤 #${step.id} 真实超限 (${realSize.toLocaleString()} > ${maxsize})，二分拆分`, {
                    query: step.query
                });
                const subSteps = await bisectOverLimitStep(
                    step, realSize, maxsize, originalStats, 0
                );
                if (subSteps && subSteps.length > 0) {
                    result.push(...subSteps);
                    splits++;
                } else {
                    // 二分失败，保留原步骤标记超限
                    step.overLimit = true;
                    step.description = `${step.description} ⚠ 真实超限 ${realSize.toLocaleString()}，二分失败`;
                    result.push(step);
                }
            } else {
                // 正常：用 realSize 覆盖 estimatedSize
                step.estimatedSize = realSize;
                result.push(step);
            }
        }

        if (onProgress) {
            onProgress({ checked, total, deviations, splits, failed });
        }
    }

    reassignStepIds(result);

    logInfo('smartdl', '预查阶段完成', {
        total, deviations, splits, failed,
        outputSteps: result.length
    });

    return result;
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

    const subStats = await fetchStatsForProbe(subQuery);
    if (!subStats) {
        // fetchStatsForProbe 已记录日志并重试过，仍失败则降级
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
 * F 点消耗授权弹窗（默认聚焦取消按钮，防误点）
 * @param {Object} step - 当前步骤
 * @param {number} consumed - 本次消耗的 F 点数
 * @returns {Promise<boolean>} true=允许继续，false=取消下载
 */
async function showFPointAuthorizeDialog(step, consumed) {
    const remaining = await getRemainingFPoint();
    const remainingStr = remaining != null ? remaining.toLocaleString() : '(未知)';
    return await showConfirm({
        title: '⚠ 检测到 F 点消耗',
        message: `步骤 #${step.id} 执行消耗了 <strong style="color: var(--error);">${consumed}</strong> F 点。\n` +
                 `当前余额：<strong>${remainingStr}</strong> F 点。\n\n` +
                 `这通常意味着 FOFA 数据在预查后更新了，实际匹配数超出预估。\n` +
                 `继续？后续步骤可能继续消耗 F 点。`,
        confirmText: '允许本次',
        cancelText: '取消下载',
        defaultFocus: 'cancel'  // 默认聚焦取消，防误点
    });
}

/**
 * 查询当前账户剩余 F 点（用于 F 点授权弹窗显示）
 * @returns {Promise<number|null>}
 */
async function getRemainingFPoint() {
    try {
        // 复用既有 fetchAccountInfo
        const { fetchAccountInfo } = await import('./api.js');
        const info = await fetchAccountInfo();
        return info?.fofa_point ?? null;
    } catch (e) {
        logWarn('smartdl', '查询 F 点余额失败', { error: e.message || String(e) });
        return null;
    }
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
 * @param {Object} sessionState - 本次执行会话状态（含 fpointAuthorized 标志）
 */
async function executeStep(step, selectedFields, freeLimit, onProgress, allResults, stepIndex, totalSteps, sessionState) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        step.status = 'running';
        step.retryCount = attempt;
        if (onProgress) onProgress();

        try {
            // 关键改动：size 用 step.realSize（预查精确值），不是 freeLimit
            // - realSize 保证 ≤ maxsize，避免翻页扣 F 点
            // - 没有 realSize（预查失败）时降级用 freeLimit
            const requestSize = (step.realSize && step.realSize > 0)
                ? Math.min(step.realSize, freeLimit)
                : freeLimit;

            const result = await fetchSearchResults(
                step.query, 1, requestSize, selectedFields,
                false, REQUEST_TIMEOUT_MS
            );
            incrementApiCalls();

            // F 点红线检查：consumed_fpoint > 0 弹窗用户授权（默认拒绝）
            if (result.consumed_fpoint > 0 && !sessionState.fpointAuthorized) {
                const approved = await showFPointAuthorizeDialog(step, result.consumed_fpoint);
                if (!approved) {
                    // 用户拒绝：抛特殊错误让 executePlan 停止
                    const err = new Error('FPOINT_UNAUTHORIZED');
                    err.code = 'FPOINT_UNAUTHORIZED';
                    throw err;
                }
                sessionState.fpointAuthorized = true;
            }

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
            // F 点授权被用户拒绝：直接抛出，不被重试逻辑吞掉，让 executePlan 优雅停止
            if (err.code === 'FPOINT_UNAUTHORIZED') {
                throw err;
            }
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

    // F 点授权会话状态（本次执行内有效）
    const sessionState = { fpointAuthorized: false };

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

        try {
            await executeStep(step, selectedFields, freeLimit, () => onProgress(planSteps), allResults, i, totalSteps, sessionState);
        } catch (e) {
            if (e.code === 'FPOINT_UNAUTHORIZED') {
                logWarn('smartdl', '用户拒绝 F 点授权，中止执行', { stepIndex: i, totalSteps });
                // 触发步骤标记为 error（避免停留在 running）
                step.status = 'error';
                step.errorMsg = '用户拒绝 F 点授权';
                // 标记剩余步骤为 skipped
                for (let j = i + 1; j < pendingSteps.length; j++) {
                    pendingSteps[j].status = 'skipped';
                    pendingSteps[j].errorMsg = '用户拒绝 F 点授权，已跳过';
                }
                break;
            }
            throw e;
        }

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
