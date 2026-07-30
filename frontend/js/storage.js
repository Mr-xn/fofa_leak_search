// js/storage.js - localStorage 和 IndexedDB 操作

import { state, DB_CONFIG, STORAGE_KEYS } from './config.js';
import { getCacheExpiry } from './utils.js';
import { debug as logDebug, info as logInfo, warn as logWarn } from './logger.js';

// ==================== IndexedDB 初始化 ====================
export function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

        request.onerror = () => {
            logWarn('cache', 'IndexedDB 初始化失败', { db: DB_CONFIG.name });
            resolve(null);
        };

        request.onsuccess = () => {
            logInfo('cache', 'IndexedDB 初始化成功', { db: DB_CONFIG.name });
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(DB_CONFIG.storeName)) {
                const store = db.createObjectStore(DB_CONFIG.storeName, { keyPath: 'cacheKey' });
                store.createIndex('query', 'query', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// ==================== 生成缓存键 ====================
export function getCacheKey(query, page, size, fields) {
    const raw = `${query}|${page}|${size}|${fields}`;
    return btoa(unescape(encodeURIComponent(raw)));
}

// ==================== 从缓存获取数据 ====================
export function getFromCache(cacheKey) {
    if (!state.db) return Promise.resolve(null);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readonly');
            const store = tx.objectStore(DB_CONFIG.storeName);
            const request = store.get(cacheKey);

            request.onsuccess = () => {
                const result = request.result;
                const cacheExpiry = getCacheExpiry();
                if (result && (Date.now() - result.timestamp) < cacheExpiry) {
                    logDebug('cache', '读取缓存命中', { cacheKey, ageMs: Date.now() - result.timestamp });
                    resolve(result);
                } else {
                    logDebug('cache', result ? '读取缓存过期' : '读取缓存未命中', { cacheKey });
                    resolve(null);
                }
            };

            request.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

// ==================== 保存数据到缓存 ====================
export function saveToCache(cacheKey, query, data) {
    if (!state.db) return Promise.resolve(false);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.storeName);
            store.put({
                cacheKey: cacheKey,
                query: query,
                data: data,
                timestamp: Date.now()
            });
            tx.oncomplete = () => { logDebug('cache', '保存缓存成功', { cacheKey, query, totalSize: data?.size, resultCount: Array.isArray(data?.results) ? data.results.length : 0 }); resolve(true); };
            tx.onerror = () => { logWarn('cache', '保存缓存失败', { cacheKey, query }); resolve(false); };
        } catch (e) {
            resolve(false);
        }
    });
}

// ==================== 清除过期缓存 ====================
export function clearExpiredCache() {
    if (!state.db) return Promise.resolve(false);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.storeName);
            const request = store.openCursor();
            const cacheExpiry = getCacheExpiry();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if ((Date.now() - cursor.value.timestamp) >= cacheExpiry) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

// ==================== 清除所有缓存 ====================
export function clearAllCache() {
    if (!state.db) return Promise.resolve(false);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.storeName);
            store.clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

// ==================== 获取缓存统计 ====================
export function getCacheStats() {
    if (!state.db) return Promise.resolve({ count: 0 });

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readonly');
            const store = tx.objectStore(DB_CONFIG.storeName);
            const countRequest = store.count();

            countRequest.onsuccess = () => {
                resolve({ count: countRequest.result });
            };

            countRequest.onerror = () => resolve({ count: 0 });
        } catch (e) {
            resolve({ count: 0 });
        }
    });
}

// ==================== 用户信息缓存 ====================
export function getCachedUserInfo() {
    try {
        const cached = localStorage.getItem(STORAGE_KEYS.userInfo);
        if (!cached) return null;

        const { data, timestamp, apiKey } = JSON.parse(cached);
        const USER_INFO_CACHE_EXPIRY = 60 * 60 * 1000; // 1小时

        if (Date.now() - timestamp > USER_INFO_CACHE_EXPIRY || apiKey !== state.apiKey) {
            localStorage.removeItem(STORAGE_KEYS.userInfo);
            return null;
        }

        return data;
    } catch (e) {
        localStorage.removeItem(STORAGE_KEYS.userInfo);
        return null;
    }
}

export function setCachedUserInfo(data) {
    try {
        localStorage.setItem(STORAGE_KEYS.userInfo, JSON.stringify({
            data: data,
            timestamp: Date.now(),
            apiKey: state.apiKey
        }));
    } catch (e) {
        // 静默处理
    }
}

// ==================== 获取所有缓存数据 ====================
export function getAllCachedData(queryFilter = null) {
    if (!state.db) return Promise.resolve([]);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readonly');
            const store = tx.objectStore(DB_CONFIG.storeName);
            const request = store.openCursor();
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const entry = cursor.value;
                    // 如果有过滤条件，检查查询语句是否匹配
                    if (!queryFilter || entry.query.includes(queryFilter)) {
                        results.push({
                            query: entry.query,
                            data: entry.data,
                            timestamp: entry.timestamp,
                            cacheKey: entry.cacheKey
                        });
                    }
                    cursor.continue();
                } else {
                    // 按时间戳降序排序
                    results.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(results);
                }
            };

            request.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

// ==================== 获取所有缓存的查询语句列表 ====================
export function getCachedQueries() {
    if (!state.db) return Promise.resolve([]);

    return new Promise((resolve) => {
        try {
            const tx = state.db.transaction(DB_CONFIG.storeName, 'readonly');
            const store = tx.objectStore(DB_CONFIG.storeName);
            const request = store.openCursor();
            const queryMap = new Map();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const entry = cursor.value;
                    if (queryMap.has(entry.query)) {
                        queryMap.get(entry.query).count++;
                        if (entry.timestamp > queryMap.get(entry.query).latest) {
                            queryMap.get(entry.query).latest = entry.timestamp;
                        }
                    } else {
                        queryMap.set(entry.query, {
                            query: entry.query,
                            count: 1,
                            latest: entry.timestamp
                        });
                    }
                    cursor.continue();
                } else {
                    const queries = Array.from(queryMap.values())
                        .sort((a, b) => b.latest - a.latest);
                    resolve(queries);
                }
            };

            request.onerror = () => resolve([]);
        } catch (e) {
            resolve([]);
        }
    });
}

// ==================== 导出为 CSV ====================
export function exportToCSV(data, filename = 'fofa_export.csv') {
    if (!data || data.length === 0) {
        return false;
    }

    // 获取所有字段名
    const fields = Object.keys(data[0]);

    // 构建 CSV 内容
    const csvContent = [
        // 表头
        fields.map(f => `"${f}"`).join(','),
        // 数据行
        ...data.map(row =>
            fields.map(f => {
                const val = row[f] ?? '';
                // 转义双引号
                return `"${String(val).replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    // 添加 BOM 以支持中文
    const bom = '﻿';
    downloadFile(bom + csvContent, filename, 'text/csv;charset=utf-8');
    return true;
}

// ==================== 导出为 JSON ====================
export function exportToJSON(data, filename = 'fofa_export.json') {
    if (!data || data.length === 0) {
        return false;
    }

    const jsonContent = JSON.stringify(data, null, 2);
    downloadFile(jsonContent, filename, 'application/json;charset=utf-8');
    return true;
}

// ==================== 下载文件辅助函数 ====================
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ==================== 月度使用统计 ====================
// 生成月度键：fofa_usage_2026-06
function getUsageKey() {
    const now = new Date();
    return `${STORAGE_KEYS.usage}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 获取当月使用数据
export function getUsageStats() {
    try {
        const key = getUsageKey();
        const data = localStorage.getItem(key);
        if (data) {
            const parsed = JSON.parse(data);
            // 兼容旧数据：确保 dataCount 字段存在
            if (parsed.dataCount === undefined) {
                parsed.dataCount = 0;
            }
            return parsed;
        }
    } catch (e) {
        // 静默处理
    }
    return { apiCalls: 0, downloads: 0, fPoints: 0, dataCount: 0 };
}

// 递增 API 调用次数（带 F 点）
export function incrementApiCalls(fPoints = 0) {
    try {
        const key = getUsageKey();
        const stats = getUsageStats();
        stats.apiCalls += 1;
        stats.fPoints += fPoints;
        localStorage.setItem(key, JSON.stringify(stats));
    } catch (e) {
        // 静默处理
    }
}

// 递增下载次数
export function incrementDownloads() {
    try {
        const key = getUsageKey();
        const stats = getUsageStats();
        stats.downloads += 1;
        localStorage.setItem(key, JSON.stringify(stats));
    } catch (e) {
        // 静默处理
    }
}

// 递增当月数据获取量
export function incrementDataCount(count) {
    try {
        const key = getUsageKey();
        const stats = getUsageStats();
        stats.dataCount = (stats.dataCount || 0) + count;
        localStorage.setItem(key, JSON.stringify(stats));
    } catch (e) {
        // 静默处理
    }
}

// ==================== 搜索历史 ====================
// 验证和清理筛选条件数据（兼容新格式 conditions 数组与旧格式 value/operator）
function sanitizeFilters(filters) {
    if (!filters || typeof filters !== 'object') return null;
    const clean = {};
    for (const [key, val] of Object.entries(filters)) {
        if (typeof key !== 'string' || !val || typeof val !== 'object' || typeof val.filter !== 'string') continue;

        if (Array.isArray(val.conditions)) {
            // 新格式：输入框类型 condition 数组
            const cleanConds = val.conditions
                .filter(c => c && c.value != null && String(c.value).trim())
                .map(c => ({
                    cid: typeof c.cid === 'string' ? c.cid : '',
                    operator: typeof c.operator === 'string' ? c.operator : '=',
                    value: String(c.value).trim(),
                }));
            if (cleanConds.length > 0) {
                clean[key] = { filter: val.filter, conditions: cleanConds };
            }
        } else if (val.value === 'true' || val.value === 'false') {
            // 布尔类型
            clean[key] = { filter: val.filter, value: val.value };
        } else if (val.value != null) {
            // 旧格式 / 选项类型
            clean[key] = { filter: val.filter, value: String(val.value), operator: val.operator || '=' };
        }
    }
    return Object.keys(clean).length > 0 ? clean : null;
}

export function addToHistory(query, filters) {
    if (!query.trim()) return;

    state.searchHistory = state.searchHistory.filter(item => item.query !== query);
    state.searchHistory.unshift({
        query: query,
        time: new Date().toISOString(),
        count: 0,
        filters: sanitizeFilters(filters)
    });

    if (state.searchHistory.length > 50) {
        state.searchHistory = state.searchHistory.slice(0, 50);
    }

    localStorage.setItem(STORAGE_KEYS.searchHistory, JSON.stringify(state.searchHistory));
}

// 获取历史记录中关联的筛选条件
export function getHistoryFilters(query) {
    const item = state.searchHistory.find(h => h.query === query);
    return item && item.filters ? item.filters : null;
}

export function deleteHistoryItem(query) {
    state.searchHistory = state.searchHistory.filter(item => item.query !== query);
    localStorage.setItem(STORAGE_KEYS.searchHistory, JSON.stringify(state.searchHistory));
}
