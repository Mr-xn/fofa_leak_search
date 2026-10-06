// js/query-normalizer.js - 查询语句规范化

/**
 * 智能/全角引号 → ASCII 引号
 * macOS WKWebView 的「智能引号」和中文输入法全角模式会把 " ' 改写成 “ ” ‘ ’ ＂ ＇，
 * FOFA 查询语法只认 ASCII 引号，统一还原
 * @param {string} s
 * @returns {string}
 */
export function normalizeQuotes(s) {
    return String(s)
        .replace(/[“”„‟＂]/g, '"')
        .replace(/[‘’‚‛＇]/g, "'");
}

/**
 * 清理查询语句，确保相同语义的查询生成相同的缓存键
 * @param {string} query - 原始查询语句
 * @returns {string} - 规范化后的查询语句
 */
export function normalizeQuery(query) {
    if (!query) return '';

    let normalized = normalizeQuotes(query.trim());

    // 1. 规范化逻辑连接符周围的空格
    normalized = normalized.replace(/\s*&&\s*/g, ' && ');
    normalized = normalized.replace(/\s*\|\|\s*/g, ' || ');

    // 2. 规范化比较运算符周围的空格
    normalized = normalized.replace(/\s*==\s*/g, '==');
    normalized = normalized.replace(/\s*!=\s*/g, '!=');
    normalized = normalized.replace(/\s*\*=\s*/g, '*=');
    normalized = normalized.replace(/\s*=\s*/g, '=');

    // 3. 规范化括号周围的空格
    normalized = normalized.replace(/\s*\(\s*/g, '(');
    normalized = normalized.replace(/\s*\)\s*/g, ')');

    // 4. 移除多余的空格
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
}

/**
 * 检测查询语句是否被一对外层括号完整包裹
 * （即最外层 ( 与末尾 ) 配对，中途 depth 未提前归零）
 * @param {string} query
 * @returns {boolean}
 */
export function isFullyWrapped(query) {
    if (!query) return false;
    const s = query.trim();
    if (s.length < 2 || s[0] !== '(' || s[s.length - 1] !== ')') return false;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') {
            depth++;
        } else if (s[i] === ')') {
            depth--;
            if (depth === 0 && i !== s.length - 1) return false;
        }
    }
    return depth === 0;
}

/**
 * 合成最终查询语句：用 && 连接条件，baseQuery 非空且未被完整括号包裹时加外层 ()
 * @param {string} baseQuery - 搜索框基础查询（不含筛选条件）
 * @param {string[]} conditionParts - 附加条件片段（如 ['after="..."', 'port="80"', 'port!="443"']）
 * @returns {string} - 合成后的查询语句
 */
export function composeQuery(baseQuery, conditionParts) {
    const conds = (conditionParts || []).filter(Boolean).join(' && ');
    const base = (baseQuery || '').trim();
    if (!conds) return normalizeQuotes(base);
    if (!base) return normalizeQuotes(conds);
    const wrappedBase = isFullyWrapped(base) ? base : `(${base})`;
    return normalizeQuotes(`${wrappedBase} && ${conds}`);
}
