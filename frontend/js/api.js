// js/api.js - API 请求封装

import { state } from './config.js';
import { debug as logDebug, info as logInfo, error as logError } from './logger.js';

// ==================== 通用 fetch 包装（带超时） ====================
async function fetchWithTimeout(url, timeoutMs) {
    if (timeoutMs === undefined) {
        const saved = parseInt(localStorage.getItem('fofa_request_timeout'));
        timeoutMs = (saved >= 5 && saved <= 300) ? saved * 1000 : 30000;
    }
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
export async function fetchSearchResults(query, page, size, fields, full = false, timeoutMs) {
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
    // 调试：捕获原始 link 字段值，用于诊断 URL 截断来源
    if (Array.isArray(data.results) && data.results.length > 0) {
        const fieldsArr = fields.split(',').map(f => f.trim());
        const linkIdx = fieldsArr.indexOf('link');
        const hostIdx = fieldsArr.indexOf('host');
        const sampleSize = Math.min(3, data.results.length);
        const samples = data.results.slice(0, sampleSize).map(row => ({
            link: linkIdx >= 0 ? row[linkIdx] : '(非选中字段)',
            host: hostIdx >= 0 ? row[hostIdx] : '(非选中字段)'
        }));
        logDebug('api', 'FOFA 原始响应 link/host 采样', { sampleCount: sampleSize, samples });
    }
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
