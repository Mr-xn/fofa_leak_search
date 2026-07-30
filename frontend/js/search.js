// js/search.js - 搜索功能（历史、建议、执行）

import { state, STORAGE_KEYS } from './config.js';
import { showToast, formatNumber, escapeHtml, formatTime } from './utils.js';
import { normalizeQuery, composeQuery } from './query-normalizer.js';
import { addToHistory, deleteHistoryItem, getCacheKey, getFromCache, saveToCache, incrementApiCalls, incrementDataCount } from './storage.js';
import { fetchSearchResults } from './api.js';
import { getSelectedFields, showApiKeyModal, getFilterQuery, getActiveFiltersData, hasActiveFilters } from './ui.js';
import { renderTable, renderPagination } from './results.js';
import { loadStats } from './stats.js';
import { info as logInfo, warn as logWarn, error as logError } from './logger.js';

// ==================== 查询可提交性判断 ====================
/**
 * 判断查询文本是否可以提交搜索
 * @param {string} query - 查询文本
 * @returns {boolean} - trim 后是否非空
 */
export function isSearchSubmittable(query) {
    return !!(query && typeof query === 'string' && query.trim().length > 0);
}

/**
 * 根据输入框内容和筛选条件更新搜索按钮的禁用状态
 */
export function updateSearchButtonState() {
    const input = document.getElementById('searchInput');
    const btn = document.querySelector('.search-btn');
    if (!input || !btn) return;

    // 输入框有内容 或 有活跃的筛选条件时，按钮可用
    const hasInput = isSearchSubmittable(input.value);
    const hasFilters = hasActiveFilters();
    const canSubmit = hasInput || hasFilters;
    btn.disabled = !canSubmit;
    btn.classList.toggle('disabled', !canSubmit);
}

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

    if (!isSearchSubmittable(query)) {
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
    const extraConditions = [];

    if (dataRange === 'full') {
        // 全部数据：full=true，不添加 after 条件
        full = true;
    } else if (dataRange.startsWith('after=')) {
        // 指定时间范围：需要 full=true 才能搜索超过一年的数据
        full = true;
        extraConditions.push(dataRange);
    }
    // dataRange === 'default' 时：近一年，full=false，不添加 after

    // 添加快速筛选条件
    const activeFiltersData = getActiveFiltersData();
    const filterQuery = getFilterQuery();
    if (filterQuery) {
        extraConditions.push(filterQuery);
    }

    // 合成最终查询（搜索框整体括号包裹，避免 || 与 && 优先级歧义）
    query = composeQuery(baseQuery, extraConditions);

    state.currentQuery = query;
    state.currentPage = 1;
    state.searchFull = full;  // 保存 full 状态供 fetchResults 使用

    // 保存到历史记录：基础查询 + 关联的筛选条件
    addToHistory(baseQuery, activeFiltersData);

    // 搜索时自动收起筛选面板
    const filterPanel = document.getElementById('quickFiltersPanel');
    const filterBtn = document.getElementById('filterToggleBtn');
    if (filterPanel && filterPanel.style.display !== 'none') {
        filterPanel.style.display = 'none';
        if (filterBtn) filterBtn.classList.remove('btn-primary');
    }

    await fetchResults();
}

export async function fetchResults() {
    if (state.isLoading) return;

    state.isLoading = true;
    state.startTime = Date.now();

    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('emptyState');
    const tableWrapper = document.getElementById('tableWrapper');
    const pagination = document.getElementById('pagination');
    const statsGrid = document.getElementById('statsGrid');

    loading.classList.add('show');
    emptyState.style.display = 'none';
    tableWrapper.style.display = 'none';
    pagination.classList.remove('show');

    const pageSize = document.getElementById('pageSize').value;
    const fields = getSelectedFields();
    const cacheKey = getCacheKey(state.currentQuery, state.currentPage, pageSize, fields);
    logInfo('search', '开始获取搜索结果', {
        query: state.currentQuery,
        page: state.currentPage,
        pageSize,
        fields,
        useCache: state.useCache
    });

    let data = null;
    let fromCache = false;

    // 尝试从缓存获取
    if (state.useCache) {
        const cached = await getFromCache(cacheKey);
        if (cached) {
            data = cached.data;
            fromCache = true;
            logInfo('search', '缓存命中', { cacheKey, query: state.currentQuery, page: state.currentPage });
        } else {
            logInfo('search', '缓存未命中', { cacheKey, query: state.currentQuery, page: state.currentPage });
        }
    }

    // 缓存未命中，从 API 获取
    if (!data) {
        try {
            data = await fetchSearchResults(state.currentQuery, state.currentPage, pageSize, fields, state.searchFull || false);

            if (data.error) {
                logWarn('search', 'FOFA 查询返回错误', { errmsg: data.errmsg, errcode: data.errcode, query: state.currentQuery });
                showToast(`查询错误: ${data.errmsg}`, 'error');
                loading.classList.remove('show');
                emptyState.style.display = 'block';
                state.isLoading = false;
                window.dispatchEvent(new CustomEvent('searchComplete'));
                return;
            }

            // 保存到缓存
            if (state.useCache) {
                await saveToCache(cacheKey, state.currentQuery, data);
            }

            // 记录 API 调用统计
            incrementApiCalls(data.consumed_fpoint || 0);
            // 累计当月数据获取量（仅 API 命中分支；缓存命中不重复计）
            incrementDataCount(data.results?.length || 0);
        } catch (error) {
            logError('search', '搜索请求网络错误', { message: error.message, query: state.currentQuery });
            showToast(`网络错误: ${error.message}`, 'error');
            loading.classList.remove('show');
            emptyState.style.display = 'block';
            state.isLoading = false;
            window.dispatchEvent(new CustomEvent('searchComplete'));
            return;
        }
    }

    state.results = data.results || [];
    state.totalResults = data.size || 0;
    logInfo('search', '搜索结果渲染', {
        query: state.currentQuery,
        fromCache,
        resultCount: state.results.length,
        totalResults: state.totalResults,
        elapsedMs: Date.now() - state.startTime
    });

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
        window.dispatchEvent(new CustomEvent('searchComplete'));
        return;
    }

    renderTable(fields.split(','));
    renderPagination(parseInt(pageSize));

    loading.classList.remove('show');
    tableWrapper.style.display = 'block';
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

    // 按配置决定是否自动加载统计聚合
    if (localStorage.getItem('fofa_auto_load_stats') === 'true') {
        loadStats();
    }

    window.dispatchEvent(new CustomEvent('searchComplete'));
}
