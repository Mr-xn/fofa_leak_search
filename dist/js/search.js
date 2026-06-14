// js/search.js - 搜索功能（历史、建议、执行）

import { state, STORAGE_KEYS } from './config.js';
import { showToast, formatNumber, escapeHtml, formatTime } from './utils.js';
import { normalizeQuery } from './query-normalizer.js';
import { addToHistory, deleteHistoryItem, getCacheKey, getFromCache, saveToCache, incrementApiCalls } from './storage.js';
import { fetchSearchResults } from './api.js';
import { getSelectedFields, showApiKeyModal, getFilterQuery, getActiveFiltersData } from './ui.js';
import { renderTable, renderPagination } from './results.js';

// ==================== 搜索建议 ====================
export function showSuggestions() {
    const input = document.getElementById('searchInput');
    const suggestions = document.getElementById('suggestions');
    const value = input.value.trim().toLowerCase();

    let filtered = state.searchHistory;
    if (value) {
        filtered = state.searchHistory.filter(item =>
            item.query.toLowerCase().includes(value)
        );
    }

    if (filtered.length === 0) {
        suggestions.classList.remove('show');
        return;
    }

    suggestions.innerHTML = filtered.map((item, index) => `
        <div class="suggestion-item" data-query="${encodeURIComponent(item.query)}">
            <span class="suggestion-query">${escapeHtml(item.query)}</span>
            <span class="suggestion-meta">
                ${formatTime(item.time)}
                <button class="suggestion-delete" data-query="${encodeURIComponent(item.query)}">删除</button>
            </span>
        </div>
    `).join('');

    suggestions.classList.add('show');
}

export function hideSuggestions() {
    document.getElementById('suggestions').classList.remove('show');
}

export function handleInputChange() {
    const input = document.getElementById('searchInput');
    if (input.value.trim()) {
        showSuggestions();
    } else {
        hideSuggestions();
    }
}

// ==================== 执行搜索 ====================
export async function doSearch() {
    const input = document.getElementById('searchInput');
    let query = input.value.trim();

    if (!query) {
        showToast('请输入查询语句', 'error');
        return;
    }

    if (!state.apiKey) {
        showApiKeyModal();
        return;
    }

    // 规范化查询语句
    query = normalizeQuery(query);
    input.value = query;

    // 保存基础查询（不含筛选条件）用于历史记录
    const baseQuery = query;

    // 解析数据范围
    const dataRange = document.getElementById('dataRange').value;
    let full = false;

    if (dataRange === 'full') {
        // 全部数据：full=true，不添加 after 条件
        full = true;
    } else if (dataRange.startsWith('after=')) {
        // 指定时间范围：需要 full=true 才能搜索超过一年的数据
        full = true;
        query = `${query} && ${dataRange}`;
    }
    // dataRange === 'default' 时：近一年，full=false，不添加 after

    // 添加快速筛选条件
    const activeFiltersData = getActiveFiltersData();
    const filterQuery = getFilterQuery();
    if (filterQuery) {
        query = `${query} && ${filterQuery}`;
    }

    state.currentQuery = query;
    state.currentPage = 1;
    state.searchFull = full;  // 保存 full 状态供 fetchResults 使用

    // 保存到历史记录：基础查询 + 关联的筛选条件
    addToHistory(baseQuery, activeFiltersData);

    await fetchResults();
}

export async function fetchResults() {
    if (state.isLoading) return;

    state.isLoading = true;
    state.startTime = Date.now();

    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.getElementById('tableContainer');
    const pagination = document.getElementById('pagination');
    const statsGrid = document.getElementById('statsGrid');

    loading.classList.add('show');
    emptyState.style.display = 'none';
    tableContainer.style.display = 'none';
    pagination.classList.remove('show');

    const pageSize = document.getElementById('pageSize').value;
    const fields = getSelectedFields();
    const cacheKey = getCacheKey(state.currentQuery, state.currentPage, pageSize, fields);

    let data = null;
    let fromCache = false;

    // 尝试从缓存获取
    if (state.useCache) {
        const cached = await getFromCache(cacheKey);
        if (cached) {
            data = cached.data;
            fromCache = true;
        }
    }

    // 缓存未命中，从 API 获取
    if (!data) {
        try {
            data = await fetchSearchResults(state.currentQuery, state.currentPage, pageSize, fields, state.searchFull || false);

            if (data.error) {
                showToast(`查询错误: ${data.errmsg}`, 'error');
                loading.classList.remove('show');
                emptyState.style.display = 'block';
                state.isLoading = false;
                return;
            }

            // 保存到缓存
            if (state.useCache) {
                await saveToCache(cacheKey, state.currentQuery, data);
            }

            // 记录 API 调用统计
            incrementApiCalls(data.consumed_fpoint || 0);
        } catch (error) {
            showToast(`网络错误: ${error.message}`, 'error');
            loading.classList.remove('show');
            emptyState.style.display = 'block';
            state.isLoading = false;
            return;
        }
    }

    state.results = data.results || [];
    state.totalResults = data.size || 0;

    // 更新统计信息
    document.getElementById('totalResults').textContent = formatNumber(state.totalResults);
    document.getElementById('currentPage').textContent = state.currentPage;
    document.getElementById('consumedFpoint').textContent = fromCache ? '0 (缓存)' : (data.consumed_fpoint || 0);
    document.getElementById('queryTime').textContent = fromCache ? '< 1ms (缓存)' : `${Date.now() - state.startTime}ms`;

    // 配额警告：检查剩余免费数据配额
    const quotaWarningEl = document.getElementById('quotaWarning');
    const quotaWarningTextEl = document.getElementById('quotaWarningText');
    const remainApiData = state.userInfo?.remain_api_data ?? -1;
    if (remainApiData !== -1 && !fromCache) {
        const usedData = data.size || 0;
        if (remainApiData <= 0) {
            quotaWarningEl.style.display = '';
            quotaWarningTextEl.textContent = '⚠️ 免费配额已用尽，将消耗F点';
            quotaWarningTextEl.style.color = 'var(--error)';
        } else if (remainApiData < parseInt(pageSize)) {
            quotaWarningEl.style.display = '';
            quotaWarningTextEl.textContent = `⚠️ 剩余配额 ${formatNumber(remainApiData)} 条，本页已超`;
            quotaWarningTextEl.style.color = 'var(--warning)';
        } else {
            quotaWarningEl.style.display = 'none';
        }
    } else {
        quotaWarningEl.style.display = 'none';
    }

    statsGrid.classList.add('show');

    if (state.results.length === 0) {
        loading.classList.remove('show');
        emptyState.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
            </svg>
            <h3>未找到结果</h3>
            <p>尝试修改查询语句或调整筛选条件</p>
        `;
        emptyState.style.display = 'block';
        state.isLoading = false;
        return;
    }

    renderTable(fields.split(','));
    renderPagination(parseInt(pageSize));

    loading.classList.remove('show');
    tableContainer.style.display = 'block';
    pagination.classList.add('show');

    // 显示下载按钮
    const downloadButtons = document.getElementById('downloadButtons');
    if (downloadButtons) {
        downloadButtons.style.display = 'flex';
    }

    if (fromCache) {
        showToast('已使用缓存数据', 'info');
    }

    state.isLoading = false;
}
