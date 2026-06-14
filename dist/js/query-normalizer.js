// js/query-normalizer.js - 查询语句规范化

/**
 * 清理查询语句，确保相同语义的查询生成相同的缓存键
 * @param {string} query - 原始查询语句
 * @returns {string} - 规范化后的查询语句
 */
export function normalizeQuery(query) {
    if (!query) return '';

    let normalized = query.trim();

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
