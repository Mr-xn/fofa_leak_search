// js/quota.js - localStorage 配额感知写入
//
// 收藏与搜索历史默认不设条数上限，能存多少取决于浏览器给的剩余空间：
// 只有 setItem 真的被拒绝（配额耗尽）时才淘汰最旧的数据后重试，
// 并把实际写入的内容回报给调用方，保证内存状态与磁盘一致。

/**
 * 判断是否为配额耗尽错误。
 * 各引擎错误名/错误码不统一，这里统一识别。
 */
export function isQuotaExceededError(err) {
    if (!err) return false;
    if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        return true;
    }
    return err.code === 22 || err.code === 1014;
}

/**
 * 写入数组型数据；配额不足时调用 evict 逐条淘汰后重试。
 *
 * @param {string} key - localStorage 键
 * @param {Array} entries - 待写入数组
 * @param {(entries: Array) => Array|null} evict - 淘汰一条并返回新数组；无可淘汰返回 null
 * @returns {{ok: boolean, dropped: number, entries: Array, error: Error|null}}
 *          ok=true 时 entries 是实际写入的内容（可能已被淘汰），调用方应据此同步内存状态；
 *          ok=false 时未发生淘汰，localStorage 保留上一次成功写入的值。
 */
export function persistWithEviction(key, entries, evict) {
    let current = entries;
    let dropped = 0;

    for (;;) {
        try {
            localStorage.setItem(key, JSON.stringify(current));
            return { ok: true, dropped, entries: current, error: null };
        } catch (err) {
            if (!isQuotaExceededError(err)) {
                return { ok: false, dropped, entries: current, error: err };
            }

            const next = evict(current);
            // 必须严格减少条目，否则终止：evict 实现有误时也不能死循环
            if (!next || next.length >= current.length) {
                return { ok: false, dropped, entries: current, error: err };
            }
            current = next;
            dropped++;
        }
    }
}

/**
 * 生成"淘汰最旧一条"的结果：time 最早者先淘汰，缺少 time 的视为最旧。
 * time 相同时（同一毫秒内连续添加）淘汰数组中靠后的一条——数组按时间倒序排列，
 * 靠后即更旧。isProtected 命中的条目永不淘汰；全部受保护（或数组为空）时返回 null。
 * 不修改传入数组。
 *
 * @param {Array} entries
 * @param {(entry: any) => boolean} isProtected
 * @returns {Array|null}
 */
export function evictOldest(entries, isProtected = () => false) {
    let targetIndex = -1;
    let oldestTime = '';

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (isProtected(entry)) continue;
        const time = entry && typeof entry.time === 'string' ? entry.time : '';
        if (targetIndex === -1 || time <= oldestTime) {
            targetIndex = i;
            oldestTime = time;
        }
    }

    if (targetIndex === -1) return null;
    return [...entries.slice(0, targetIndex), ...entries.slice(targetIndex + 1)];
}
