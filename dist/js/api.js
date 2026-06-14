// js/api.js - API 请求封装

import { state } from './config.js';

// ==================== 获取账号信息 ====================
export async function fetchAccountInfo() {
    const response = await fetch(`${state.apiBaseUrl}/api/info/my?key=${state.apiKey}`);
    return response.json();
}

// ==================== 搜索资产 ====================
export async function fetchSearchResults(query, page, size, fields, full = false) {
    const qbase64 = btoa(unescape(encodeURIComponent(query)));
    let url = `${state.apiBaseUrl}/api/search/all?key=${state.apiKey}&qbase64=${qbase64}&page=${page}&size=${size}&fields=${fields}`;
    if (full) {
        url += '&full=true';
    }
    const response = await fetch(url);
    return response.json();
}
