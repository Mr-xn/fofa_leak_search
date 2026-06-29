// js/smart-downloader.js - 智能分片下载模块
// 将大查询拆分为多个小查询，以适配免费 API 单次查询限制

import { state, SMART_DOWNLOAD_HARD_LIMIT, VIP_MONTHLY_DATA_QUOTA, VIP_LEVEL_MAP } from './config.js';
import { fetchStats, fetchSearchResults } from './api.js';
import { incrementApiCalls, getUsageStats, incrementDataCount } from './storage.js';
import { isTauri } from './tauri-bridge.js';

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
    try {
        const result = await fetchStats(query, '');
        incrementApiCalls();
        if (result.error) return -1;
        return result.size ?? -1;
    } catch {
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
    try {
        const fields = PLANNABLE_FIELDS.join(',');
        const result = await fetchStats(query, fields);
        incrementApiCalls();
        if (result.error) return null;
        return result;
    } catch {
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

/**
 * 根据统计数据规划拆分查询方案
 * @param {string} baseQuery - 基础查询
 * @param {Object} stats - analyzeDimensions 返回的统计数据
 * @param {number} freeLimit - 单次查询限制
 * @param {number} [maxTotalLimit=SMART_DOWNLOAD_HARD_LIMIT] - 本次总上限
 * @returns {Array<Object>} 查询计划步骤数组
 */
export function planQueries(baseQuery, stats, freeLimit, maxTotalLimit = SMART_DOWNLOAD_HARD_LIMIT) {
    // 实际可规划的数据量 = min(stats.size, maxTotalLimit)
    const planSize = Math.min(stats.size, maxTotalLimit);

    // Case 1: 总量在限制内，无需拆分
    if (planSize <= freeLimit) {
        return [{
            id: 1,
            query: baseQuery,
            estimatedSize: planSize,
            description: planSize < stats.size
                ? `部分结果 (${planSize.toLocaleString()}/${stats.size.toLocaleString()} 条，受配额限制)`
                : `全部结果 (${planSize.toLocaleString()} 条)`,
            status: 'pending'
        }];
    }

    // 构造裁剪后的 stats 用于规划
    const planStats = { ...stats, size: planSize };

    // Case 2: 按单维度拆分
    for (const field of PLANNABLE_FIELDS) {
        const aggs = planStats.aggs?.[field];
        if (!aggs || aggs.length === 0) continue;

        const plan = trySplitByField(baseQuery, planStats, field, aggs, freeLimit);
        if (plan) return plan;
    }

    // Case 3: 多维度组合拆分 — 选择覆盖最多的维度作为主维度
    const bestField = PLANNABLE_FIELDS.reduce((best, field) => {
        const aggs = planStats.aggs?.[field];
        if (!aggs) return best;
        const total = aggs.reduce((s, a) => s + a.count, 0);
        return total > best.total ? { field, total } : best;
    }, { field: null, total: 0 });

    if (bestField.field) {
        const plan = trySplitByField(baseQuery, planStats, bestField.field, planStats.aggs[bestField.field], freeLimit);
        if (plan) return plan;
    }

    // Fallback: 返回单条查询（可能超限，但避免卡住）
    return [{
        id: 1,
        query: baseQuery,
        estimatedSize: planSize,
        description: planSize < stats.size
            ? `部分结果 (${planSize.toLocaleString()}/${stats.size.toLocaleString()} 条，受配额限制)`
            : `全部结果 (${planSize.toLocaleString()} 条，无法自动拆分)`,
        status: 'pending'
    }];
}

/**
 * 尝试按单个字段拆分查询
 * @param {string} baseQuery
 * @param {Object} stats
 * @param {string} field
 * @param {Array} aggs - 该字段的聚合数据 [{count, name}, ...]
 * @param {number} freeLimit
 * @returns {Array<Object>|null} 计划步骤数组，无法拆分时返回 null
 */
function trySplitByField(baseQuery, stats, field, aggs, freeLimit) {
    const steps = [];
    let stepId = 1;
    let coveredCount = 0;

    // 处理 top 5 中的每个值
    const usedValues = [];
    let i = 0;

    while (i < aggs.length) {
        const entry = aggs[i];

        // 单个值即可容纳
        if (entry.count <= freeLimit) {
            // 尝试将后续小值合并到同一批次
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
            // 单个值超限，尝试添加次级维度拆分
            const subSplit = trySubSplit(baseQuery, field, entry, stats, freeLimit);
            if (subSplit) {
                subSplit.forEach(s => {
                    s.id = stepId++;
                    steps.push(s);
                });
                usedValues.push(entry.name);
                coveredCount += entry.count;
                i++;
            } else {
                // 无法拆分此值，跳过（后续会被余量覆盖或标记）
                usedValues.push(entry.name);
                coveredCount += entry.count;
                i++;
            }
        }
    }

    // 检查余量：不在 top 5 中的数据
    const remaining = stats.size - coveredCount;
    if (remaining > 0) {
        if (remaining <= freeLimit) {
            // 余量可单次查询
            const query = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
            steps.push({
                id: stepId++,
                query,
                estimatedSize: remaining,
                description: `其他 ${field} (${remaining.toLocaleString()} 条)`,
                status: 'pending'
            });
        } else if (usedValues.length > 0) {
            // 余量仍超限，需要进一步拆分 — 使用可规划字段中排除当前字段后的维度
            const secondaryField = PLANNABLE_FIELDS.find(f => f !== field && stats.aggs?.[f]?.length > 0);
            if (secondaryField) {
                const negQuery = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
                const subStats = { size: remaining, aggs: stats.aggs };
                const subPlan = trySplitByField(negQuery, subStats, secondaryField, stats.aggs[secondaryField] || [], freeLimit);
                if (subPlan) {
                    subPlan.forEach(s => {
                        s.id = stepId++;
                        steps.push(s);
                    });
                } else {
                    // 无法进一步拆分
                    const query = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
                    steps.push({
                        id: stepId++,
                        query,
                        estimatedSize: remaining,
                        description: `其他 ${field} (${remaining.toLocaleString()} 条，可能超限)`,
                        status: 'pending'
                    });
                }
            } else {
                const query = buildQuery(baseQuery, [{ field, op: '!=', values: usedValues }]);
                steps.push({
                    id: stepId++,
                    query,
                    estimatedSize: remaining,
                    description: `其他 ${field} (${remaining.toLocaleString()} 条，可能超限)`,
                    status: 'pending'
                });
            }
        }
    }

    // 验证：所有步骤都必须在限制内才认为拆分成功
    const allUnderLimit = steps.every(s => s.estimatedSize <= freeLimit);
    if (!allUnderLimit) return null;

    return steps;
}

/**
 * 尝试对单个超限值添加次级维度进行拆分
 * @param {string} baseQuery
 * @param {string} primaryField - 主维度字段名
 * @param {Object} entry - {count, name}
 * @param {Object} stats - 完整统计数据
 * @param {number} freeLimit
 * @returns {Array<Object>|null} 子步骤数组，无法拆分时返回 null
 */
function trySubSplit(baseQuery, primaryField, entry, stats, freeLimit) {
    // 找一个可用的次级维度
    const secondaryField = PLANNABLE_FIELDS.find(f => f !== primaryField && stats.aggs?.[f]?.length > 0);
    if (!secondaryField) return null;

    const subAggs = stats.aggs[secondaryField];
    const steps = [];
    let coveredCount = 0;
    const usedValues = [];

    for (const subEntry of subAggs) {
        // 估算交叉计数：按比例分配
        const estimatedCrossCount = Math.ceil(entry.count * (subEntry.count / stats.size));
        if (estimatedCrossCount > freeLimit) continue;

        const query = buildQuery(baseQuery, [
            { field: primaryField, op: '=', values: [entry.name] },
            { field: secondaryField, op: '=', values: [subEntry.name] }
        ]);
        steps.push({
            id: 0, // 稍后由调用方分配
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

    // 验证拆分有效性
    if (steps.length === 0) return null;
    const allUnderLimit = steps.every(s => s.estimatedSize <= freeLimit);
    return allUnderLimit ? steps : null;
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

                console.warn(`[SmartDL] Step ${stepIndex + 1}/${totalSteps} attempt ${attempt} API error:`, JSON.stringify(errDetail));
                console.warn(`[SmartDL] Query: ${step.query}`);

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
                console.log(`[SmartDL] Step ${stepIndex + 1}/${totalSteps} done: ${step.results.length} items`);
                return;
            }
        } catch (err) {
            lastError = err.name === 'AbortError'
                ? `请求超时 (${REQUEST_TIMEOUT_MS / 1000}s)`
                : (err.message || '网络错误');
            console.warn(`[SmartDL] Step ${stepIndex + 1}/${totalSteps} attempt ${attempt} error: ${lastError}`);
            console.warn(`[SmartDL] Query: ${step.query}`);

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
    step.status = 'error';
    step.errorMsg = lastError || '请求失败';
    step.retryCount = undefined;
    console.error(`[SmartDL] Step ${stepIndex + 1}/${totalSteps} failed after ${MAX_RETRIES} attempts: ${step.errorMsg}`);
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
    const totalFetched = allResults.reduce((sum, r) => sum + r.length, 0);

    // 记录当月数据获取量
    if (mergedResults.length > 0) {
        incrementDataCount(mergedResults.length);
    }

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
            return result.rows;
        } catch (e) {
            console.warn('[SmartDownloader] Rust dedup failed, falling back to JS:', e);
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
