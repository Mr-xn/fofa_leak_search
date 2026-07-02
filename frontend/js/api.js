// js/api.js - API 请求封装

import { state } from './config.js';
import { debug as logDebug, info as logInfo, error as logError } from './logger.js';

// ==================== 通用 fetch 包装（带超时） ====================
async function fetchWithTimeout(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    logDebug('api', 'HTTP 请求开始', { url, timeoutMs, method: 'GET' });
    try {
        const response = await fetch(url, { signal: controller.signal });
        logInfo('api', 'HTTP 响应完成', {
            url,
            status: response.status,
            ok: response.ok,
            responseUrl: response.url,
            elapsedMs: Date.now() - started
        });
        return response;
    } catch (e) {
        logError('api', 'HTTP 请求失败', {
            url,
            name: e.name,
            message: e.message,
            elapsedMs: Date.now() - started
        });
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// ==================== 获取账号信息 ====================
export async function fetchAccountInfo() {
    const response = await fetchWithTimeout(`${state.apiBaseUrl}/api/info/my?key=${state.apiKey}`);
    return response.json();
}

// ==================== 搜索资产 ====================
export async function fetchSearchResults(query, page, size, fields, full = false, timeoutMs = 30000) {
    const qbase64 = btoa(unescape(encodeURIComponent(query)));
    let url = `${state.apiBaseUrl}/api/search/all?key=${state.apiKey}&qbase64=${qbase64}&page=${page}&size=${size}&fields=${fields}`;
    if (full) {
        url += '&full=true';
    }
    const response = await fetchWithTimeout(url, timeoutMs);
    const data = await response.json();
    logInfo('api', 'FOFA 搜索响应摘要', {
        query,
        page,
        size,
        fields,
        full,
        error: data.error,
        errmsg: data.errmsg,
        errcode: data.errcode,
        totalSize: data.size,
        resultCount: Array.isArray(data.results) ? data.results.length : 0,
        consumedFpoint: data.consumed_fpoint
    });
    return data;
}

// ==================== 统计聚合 ====================
export async function fetchStats(query, fields) {
    const qbase64 = btoa(unescape(encodeURIComponent(query)));
    let url = `${state.apiBaseUrl}/api/search/stats?key=${state.apiKey}&qbase64=${qbase64}`;
    if (fields) {
        url += `&fields=${fields}`;
    }
    const response = await fetchWithTimeout(url);
    return response.json();
}
