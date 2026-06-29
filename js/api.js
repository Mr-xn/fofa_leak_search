// js/api.js - API 请求封装

import { state } from './config.js';

// ==================== 通用 fetch 包装（带超时） ====================
async function fetchWithTimeout(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        return response;
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
    return response.json();
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
