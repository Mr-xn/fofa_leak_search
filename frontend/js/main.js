// js/main.js - 主入口（初始化、事件绑定）

import { state, STORAGE_KEYS, APP_VERSION } from './config.js';
import { showToast, debounce, escapeHtml } from './utils.js';
import { initTauriBridge, isTauri, openUrl } from './tauri-bridge.js';
import { initIndexedDB, clearExpiredCache, deleteHistoryItem, clearAllCache as clearAllCacheStorage, getCachedUserInfo, setCachedUserInfo, getUsageStats, getHistoryFilters } from './storage.js';
import { showApiKeyModal, closeApiKeyModal, togglePasswordVisibility, saveApiKey,
         showCacheManager, closeCacheModal, initFieldTags, closeUserInfo, exportCacheData,
         toggleFieldsDropdown, toggleField, removeField,
         initQuickFilters, toggleFilters, toggleFilter, updateFilterOperator, updateFilterInput, removeFilter, clearAllFilters, getFilterQuery,
         restoreFiltersFromData,
         exportConfigToFile, importConfigFromFile, toggleAdvanced, setSearchButtonUpdater,
         showSettingsModal, closeSettingsModal, saveSettingsApiKey, toggleSettingsPassword, saveProxySettings, toggleProxyEnabled, restoreProxyOnStartup,
         resetUserAgent, saveRequestConfig, renderLogViewer, clearDiagnosticLogs, exportDiagnosticLogs } from './ui.js';
import { doSearch, showSuggestions, hideSuggestions, handleInputChange, fetchResults, updateSearchButtonState } from './search.js';
import { sortTable, goToPage, downloadCurrentPage, downloadAllPages, closeDownloadModal, startDownload, hideDownloadProgress, copyColumn, setFetchResults, openAllLinks } from './results.js';
import { showUserInfo, refreshUserInfo } from './user-info.js';
import { fetchAccountInfo } from './api.js';
import { toggleStats, refreshStats, updateStatsButtonState, downloadStatsScreenshot } from './stats.js';
import { toggleFavoritesPanel, closeFavoritesPanel, toggleFavorite, clearAllFavorites, handleClearAllFavorites, renderFavoritesList, fillFromFavorite, removeFavorite, isFavorite, updateFavoriteButtonState, handleFavoriteClick, updateFavCount, seedSystemRules, getRenderedFavorite, setActiveFavTag, isSystemFavorite, updateFavoriteName, updateFavoriteTags, renameCustomTag } from './favorites.js';
import { autoCheckUpdate, manualCheckUpdate } from './updater.js';
import { showIconHashModal, closeIconHashModal, fetchIconFromUrl, handleIconFileSelect, copyIconHash, applyIconHashFilter, applyIconHashToQuery } from './icon-hash.js';
import { getFreeLimit, estimateQuerySize, analyzeDimensions, planQueries, executePlan, getVipLevel, getMonthlyQuota, getMonthlyUsed, getRemainingQuota, getMaxDownloadLimit, MAX_RETRIES } from './smart-downloader.js';
import { SMART_DOWNLOAD_HARD_LIMIT, VIP_LEVEL_MAP } from './config.js';
import { getSelectedFields } from './ui.js';
import { setLoggingEnabled, setLogLevel, info as logInfo, warn as logWarn, error as logError } from './logger.js';

// ==================== 全局函数导出 ====================
// HTML 中的 onclick 需要访问这些函数
window.showApiKeyModal = showApiKeyModal;
window.closeApiKeyModal = closeApiKeyModal;
window.togglePasswordVisibility = togglePasswordVisibility;
window.saveApiKey = saveApiKey;
window.showCacheManager = showCacheManager;
window.closeCacheModal = closeCacheModal;
window.clearAllCache = async () => {
    await clearAllCacheStorage();
    showToast('缓存已清除', 'success');
};
window.doSearch = doSearch;
window.showUserInfo = showUserInfo;
window.closeUserInfo = closeUserInfo;
window.refreshUserInfo = refreshUserInfo;
window.exportCacheData = exportCacheData;
window.toggleFieldsDropdown = toggleFieldsDropdown;
window.toggleField = toggleField;
window.removeField = removeField;
window.toggleFilters = toggleFilters;
window.toggleFilter = toggleFilter;
window.updateFilterOperator = updateFilterOperator;
window.updateFilterInput = updateFilterInput;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.exportConfigToFile = exportConfigToFile;
window.importConfigFromFile = importConfigFromFile;
window.showSettingsModal = showSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsApiKey = saveSettingsApiKey;
window.toggleSettingsPassword = toggleSettingsPassword;
window.saveProxySettings = saveProxySettings;
window.handleProxyToggle = (checked) => toggleProxyEnabled(checked);
window.resetUserAgent = resetUserAgent;
window.saveRequestConfig = saveRequestConfig;
window.openAllLinks = openAllLinks;
window.downloadCurrentPage = downloadCurrentPage;
window.downloadAllPages = downloadAllPages;
window.closeDownloadModal = closeDownloadModal;
window.startDownload = startDownload;
window.hideDownloadProgress = hideDownloadProgress;
window.openUrl = openUrl;
window.toggleStats = toggleStats;
window.refreshStats = refreshStats;
window.downloadStatsScreenshot = downloadStatsScreenshot;
window.selectSuggestion = (query) => {
    document.getElementById('searchInput').value = query;
    hideSuggestions();

    // 从历史记录恢复关联的筛选条件
    const historyFilters = getHistoryFilters(query);
    if (historyFilters && Object.keys(historyFilters).length > 0) {
        restoreFiltersFromData(historyFilters);
        showToast('已从历史记录恢复筛选条件', 'info');
    }

    doSearch();
};
window.deleteHistoryItem = (query) => {
    deleteHistoryItem(query);
    showSuggestions();
};
window.toggleFavoritesPanel = toggleFavoritesPanel;
window.closeFavoritesPanel = closeFavoritesPanel;
window.toggleFavorite = toggleFavorite;
window.clearAllFavorites = handleClearAllFavorites;
window.renderFavoritesList = renderFavoritesList;
window.fillFromFavorite = fillFromFavorite;
window.removeFavorite = removeFavorite;
window.isFavorite = isFavorite;
window.updateFavoriteButtonState = updateFavoriteButtonState;
window.handleFavoriteClick = handleFavoriteClick;
window.updateFavCount = updateFavCount;
window.isSystemFavorite = isSystemFavorite;
window.updateFavoriteName = updateFavoriteName;
window.updateFavoriteTags = updateFavoriteTags;
window.manualCheckUpdate = manualCheckUpdate;
window.saveAutoCheckUpdate = saveAutoCheckUpdate;
window.showIconHashModal = showIconHashModal;
window.closeIconHashModal = closeIconHashModal;
window.fetchIconFromUrl = fetchIconFromUrl;
window.handleIconFileSelect = handleIconFileSelect;
window.copyIconHash = copyIconHash;
window.applyIconHashFilter = applyIconHashFilter;
window.applyIconHashToQuery = applyIconHashToQuery;
window.sortTable = sortTable;
window.copyColumn = copyColumn;
window.goToPage = goToPage;
window.toggleAdvanced = toggleAdvanced;

// ==================== 智能分片下载 ====================
let smartPlanSteps = [];
let smartMergedResults = null;

window.openSmartDownload = () => {
    if (!state.currentQuery) {
        showToast('请先执行搜索', 'error');
        return;
    }
    if (!state.apiKey) {
        showApiKeyModal();
        return;
    }
    // 重置状态
    smartPlanSteps = [];
    smartMergedResults = null;

    const modal = document.getElementById('smartDownloadModal');
    modal.classList.add('show');

    // 重置 UI
    document.getElementById('smartAnalyzeInfo').innerHTML = '点击「开始分析」统计当前查询的数据分布';
    document.getElementById('smartModalEl').classList.remove('expanded');
    document.getElementById('smartPhasePlan').style.display = 'none';
    document.getElementById('smartPlanGrid').innerHTML = '';
    document.getElementById('smartPlanBadge').textContent = '';
    document.getElementById('smartPhaseExecute').style.display = 'none';
    document.getElementById('smartResultSummary').style.display = 'none';
    document.getElementById('smartStartBtn').style.display = '';
    document.getElementById('smartExecuteBtn').style.display = 'none';
    document.getElementById('smartExportBtn').style.display = 'none';

    setPhaseIcon('smartPhaseAnalyzeIcon', 'pending', '1');
    setPhaseIcon('smartPhasePlanIcon', 'pending', '2');
    setPhaseIcon('smartPhaseExecuteIcon', 'pending', '3');
};

window.closeSmartDownload = () => {
    document.getElementById('smartDownloadModal').classList.remove('show');
};

window.startSmartDownload = async () => {
    const startBtn = document.getElementById('smartStartBtn');
    startBtn.disabled = true;
    startBtn.textContent = '分析中...';

    const freeLimit = getFreeLimit();

    // Step 0: 配额预检查
    const vipLevel = getVipLevel();
    const monthlyQuota = getMonthlyQuota();
    const monthlyUsed = getMonthlyUsed();
    const remaining = getRemainingQuota();

    if (remaining === 0) {
        setPhaseIcon('smartPhaseAnalyzeIcon', 'error', '✗');
        document.getElementById('smartAnalyzeInfo').innerHTML =
            `<span style="color:var(--error)">⚠ 当月数据配额已用尽 (${monthlyUsed.toLocaleString()}/${monthlyQuota === Infinity ? '无限制' : monthlyQuota.toLocaleString()})</span><br>` +
            `当前等级: <strong>${VIP_LEVEL_MAP[vipLevel] || '注册用户'}</strong><br>` +
            `请下月再试或升级账户以获取更多配额`;
        startBtn.disabled = false;
        startBtn.textContent = '重新分析';
        return;
    }

    // Phase 1: 分析
    setPhaseIcon('smartPhaseAnalyzeIcon', 'running', '⟳');
    document.getElementById('smartAnalyzeInfo').innerHTML = '正在查询数据分布...';

    const stats = await analyzeDimensions(state.currentQuery);
    if (!stats) {
        setPhaseIcon('smartPhaseAnalyzeIcon', 'error', '✗');
        document.getElementById('smartAnalyzeInfo').innerHTML = '<span style="color:var(--error)">分析失败，请检查 API Key 和网络</span>';
        startBtn.disabled = false;
        startBtn.textContent = '重新分析';
        return;
    }

    // 计算本次可用量
    const { limit: maxTotalLimit, reason: limitReason } = getMaxDownloadLimit(stats.size);

    if (maxTotalLimit === 0) {
        setPhaseIcon('smartPhaseAnalyzeIcon', 'error', '✗');
        document.getElementById('smartAnalyzeInfo').innerHTML =
            `<span style="color:var(--error)">⚠ 配额不足，无法下载</span><br>` +
            `查询匹配: ${stats.size.toLocaleString()} 条 · ${limitReason}`;
        startBtn.disabled = false;
        startBtn.textContent = '重新分析';
        return;
    }

    setPhaseIcon('smartPhaseAnalyzeIcon', 'done', '✓');

    // 显示分析结果 + 配额信息
    let analyzeHtml = `<div class="query-line">${escapeHtml(state.currentQuery)}</div>`;
    analyzeHtml += `<div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:8px;">`;
    analyzeHtml += `<span><strong>数据量：</strong>${stats.size.toLocaleString()} 条</span>`;
    analyzeHtml += `<span><strong>单次限制：</strong>${freeLimit.toLocaleString()} 条</span>`;
    analyzeHtml += `<span><strong>需要拆分：</strong>${maxTotalLimit > freeLimit ? '至少 ' + Math.ceil(maxTotalLimit / freeLimit) + ' 步' : '否'}</span>`;
    analyzeHtml += `</div>`;

    // 配额信息
    analyzeHtml += `<div style="margin: 10px 0 0; padding: 8px 12px; background: var(--primary-light); border-radius: 6px; font-size: 12px; line-height: 1.7;">`;
    analyzeHtml += `<strong>配额：</strong>${VIP_LEVEL_MAP[vipLevel] || '注册用户'} · `;
    analyzeHtml += `已用 ${monthlyUsed.toLocaleString()} 条 · `;
    if (monthlyQuota === Infinity) {
        analyzeHtml += `无限制`;
    } else {
        analyzeHtml += `配额 ${monthlyQuota.toLocaleString()} · 剩余 ${remaining.toLocaleString()}`;
    }
    analyzeHtml += `<br>`;
    analyzeHtml += `<strong>本次可用：</strong>${maxTotalLimit.toLocaleString()} 条 — ${limitReason}`;
    analyzeHtml += `</div>`;

    if (stats.distinct) {
        const parts = [];
        if (stats.distinct.ip) parts.push(`IP: ${stats.distinct.ip.toLocaleString()}`);
        if (stats.distinct.domain) parts.push(`域名: ${stats.distinct.domain.toLocaleString()}`);
        if (stats.distinct.server) parts.push(`Server: ${stats.distinct.server.toLocaleString()}`);
        if (parts.length > 0) {
            analyzeHtml += `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">${parts.join(' · ')}</div>`;
        }
    }

    // 显示各维度 top 5
    if (stats.aggs) {
        const fieldLabels = { asn: 'ASN', country: '国家', port: '端口', server: 'HTTP Server', org: '组织' };
        for (const [field, items] of Object.entries(stats.aggs)) {
            if (!items || items.length === 0) continue;
            analyzeHtml += `<div style="margin-top:8px;"><strong style="font-size:12px;">${fieldLabels[field] || field} Top 5</strong></div>`;
            analyzeHtml += `<div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">`;
            items.forEach(item => {
                analyzeHtml += `${item.name}(${item.count.toLocaleString()}) `;
            });
            analyzeHtml += `</div>`;
        }
    }

    document.getElementById('smartAnalyzeInfo').innerHTML = analyzeHtml;

    // Phase 2: 规划 (传入 maxTotalLimit)
    setPhaseIcon('smartPhasePlanIcon', 'running', '⟳');
    document.getElementById('smartPhasePlan').style.display = '';
    document.getElementById('smartModalEl').classList.add('expanded');

    smartPlanSteps = planQueries(state.currentQuery, stats, freeLimit, maxTotalLimit);
    renderPlanSteps();

    // 更新方案数量徽标
    const planCount = smartPlanSteps.length;
    const planTotal = smartPlanSteps.reduce((s, st) => s + st.estimatedSize, 0);
    document.getElementById('smartPlanBadge').textContent = `${planCount} 步 · ${planTotal.toLocaleString()} 条`;

    setPhaseIcon('smartPhasePlanIcon', 'done', '✓');
    document.getElementById('smartExecuteBtn').style.display = '';

    startBtn.disabled = false;
    startBtn.textContent = '重新分析';
};

window.executeSmartDownload = async () => {
    const execBtn = document.getElementById('smartExecuteBtn');
    execBtn.disabled = true;
    execBtn.textContent = '下载中...';
    document.getElementById('smartStartBtn').disabled = true;

    // Phase 3: 执行
    setPhaseIcon('smartPhaseExecuteIcon', 'running', '⟳');
    document.getElementById('smartPhaseExecute').style.display = '';
    document.getElementById('smartPhaseExecute').scrollIntoView({ behavior: 'smooth', block: 'center' });

    const fields = getSelectedFields();
    const startTime = Date.now();

    const result = await executePlan(state.currentQuery, smartPlanSteps, fields, (steps) => {
        renderPlanSteps();
        // 更新进度条
        const done = steps.filter(s => s.status === 'done' || s.status === 'error').length;
        const total = steps.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        document.getElementById('smartProgressBar').style.width = `${pct}%`;
        document.getElementById('smartExecuteInfo').innerHTML = `已完成 ${done}/${total} 步 (${pct}%)`;
    });

    smartMergedResults = result.mergedResults;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // 更新最终状态
    const hasErrors = smartPlanSteps.some(s => s.status === 'error');
    setPhaseIcon('smartPhaseExecuteIcon', hasErrors ? 'error' : 'done', hasErrors ? '!' : '✓');

    // 显示结果摘要
    document.getElementById('smartResultSummary').style.display = '';
    document.getElementById('smartTotalFetched').textContent = result.stats.totalFetched.toLocaleString();
    document.getElementById('smartUniqueCount').textContent = result.stats.uniqueCount.toLocaleString();
    document.getElementById('smartDuplicateCount').textContent = result.stats.duplicateCount.toLocaleString();
    document.getElementById('smartStepsInfo').textContent = `${result.stats.stepsCompleted}/${result.stats.stepsTotal}`;

    document.getElementById('smartExecuteInfo').innerHTML =
        `下载完成，耗时 ${elapsed}s。去重后 <strong>${result.stats.uniqueCount.toLocaleString()}</strong> 条唯一数据。` +
        (result.stats.duplicateCount > 0 ? ` (${result.stats.duplicateCount.toLocaleString()} 条重复已去除)` : '') +
        (hasErrors ? ' <span style="color:var(--error)">⚠ 部分步骤失败</span>' : '');

    execBtn.style.display = 'none';
    document.getElementById('smartExportBtn').style.display = '';
    document.getElementById('smartStartBtn').disabled = false;

    showToast(`智能下载完成: ${result.stats.uniqueCount.toLocaleString()} 条数据`, 'success');
};

window.exportSmartResults = () => {
    if (!smartMergedResults || smartMergedResults.length === 0) {
        showToast('没有可导出的数据', 'error');
        return;
    }

    const fields = getSelectedFields().split(',');
    const BOM = '﻿';
    const header = fields.map(f => `"${f}"`).join(',');

    // 根据设置决定是否添加查询元数据行
    const includeQuery = localStorage.getItem(STORAGE_KEYS.exportIncludeQuery) === 'true';
    let metaRow = '';
    if (includeQuery) {
        const queryStr = state.currentQuery || '(无)';
        const exportTime = new Date().toLocaleString('zh-CN', { hour12: false });
        const escapedQuery = String(queryStr).replace(/"/g, '""');
        metaRow = `"查询: ${escapedQuery}    导出时间: ${exportTime}    条数: ${smartMergedResults.length}",` + fields.slice(1).map(() => '').join(',') + '\n';
    }

    const rows = smartMergedResults.map(row =>
        row.map(cell => {
            const value = cell ?? '';
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',')
    );

    const csvContent = BOM + metaRow + header + '\n' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    link.download = `fofa_smart_${smartMergedResults.length}条_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`已导出 ${smartMergedResults.length} 条数据`, 'success');
};

function setPhaseIcon(id, status, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `phase-icon phase-${status}`;
    el.textContent = text;
}

function renderPlanSteps() {
    const grid = document.getElementById('smartPlanGrid');
    if (!grid) return;

    grid.innerHTML = smartPlanSteps.map(step => {
        const statusClass = `step-${step.status}`;
        const iconMap = { pending: '○', running: '⟳', done: '✓', error: '✗' };
        const iconClass = `phase-${step.status}`;
        const retryInfo = step.retryCount > 1 ? ` <span style="color:var(--warning);font-size:10px;">重试${step.retryCount}/${MAX_RETRIES}</span>` : '';
        const errorInfo = step.status === 'error' && step.errorMsg ? `<div class="step-error-msg">${escapeHtml(step.errorMsg)}</div>` : '';
        const resultInfo = step.status === 'done' && step.results ? ` <span style="color:var(--success);font-size:10px;">(${step.results.length}条)</span>` : '';
        return `
            <div class="smart-plan-item ${statusClass}">
                <span class="step-status-icon ${iconClass}">${iconMap[step.status]}</span>
                <div class="step-content">
                    <div class="step-desc">${escapeHtml(step.description)}${retryInfo}${resultInfo}</div>
                    <div class="step-query" title="${escapeHtml(step.query)}">${escapeHtml(step.query)}</div>
                    ${errorInfo}
                </div>
                <span class="step-count">${step.estimatedSize.toLocaleString()} 条</span>
            </div>
        `;
    }).join('');
}

// 使用统计弹窗
window.showUsageStats = () => {
    const stats = getUsageStats();
    const now = new Date();
    const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;

    // 获取配额信息
    const vipLevel = getVipLevel();
    const monthlyQuota = getMonthlyQuota();
    const dataCount = stats.dataCount || 0;

    document.getElementById('usageMonth').textContent = `${monthStr} 使用情况`;
    document.getElementById('usageApiCalls').textContent = stats.apiCalls.toLocaleString();
    document.getElementById('usageDownloads').textContent = stats.downloads.toLocaleString();
    document.getElementById('usageFPoints').textContent = stats.fPoints.toLocaleString();
    document.getElementById('usageDataCount').textContent = dataCount.toLocaleString();

    // 配额进度条
    const quotaBar = document.getElementById('usageQuotaBar');
    const quotaText = document.getElementById('usageQuotaText');
    if (monthlyQuota === Infinity) {
        quotaBar.style.width = '0%';
        quotaText.textContent = `${VIP_LEVEL_MAP[vipLevel] || '注册用户'} · 无限制`;
    } else {
        const pct = Math.min(100, Math.round((dataCount / monthlyQuota) * 100));
        quotaBar.style.width = `${pct}%`;
        quotaBar.style.background = pct > 80 ? 'var(--error)' : pct > 60 ? 'var(--warning)' : 'linear-gradient(90deg, var(--primary), #6366f1)';
        quotaText.textContent = `${dataCount.toLocaleString()} / ${monthlyQuota.toLocaleString()} 条 (${pct}%) · ${VIP_LEVEL_MAP[vipLevel] || '注册用户'}`;
    }

    document.getElementById('usageModal').classList.add('show');
};

window.closeUsageModal = () => {
    document.getElementById('usageModal').classList.remove('show');
};

window.showAboutModal = () => {
    document.getElementById('aboutModal').classList.add('show');
};

window.closeAboutModal = () => {
    document.getElementById('aboutModal').classList.remove('show');
};

// 清除搜索输入框内容
window.clearSearchInput = () => {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('searchClearBtn');
    searchInput.value = '';
    clearBtn.classList.remove('show');
    searchInput.focus();
    updateSearchButtonState();
};

// 复制当前查询语句（解码后的明文）
window.copyCurrentQuery = () => {
    const query = state.currentQuery;
    if (!query) {
        showToast('没有可复制的查询语句', 'error');
        return;
    }

    // 直接使用 state.currentQuery（已经是解码后的明文），无需 base64 解码
    // 安全处理：使用 text/plain 写入剪贴板，避免 XSS
    navigator.clipboard.writeText(query).then(() => {
        const btn = document.getElementById('copyQueryBtn');
        btn.classList.add('copied');
        showToast('查询语句已复制', 'success');
        setTimeout(() => {
            btn.classList.remove('copied');
        }, 1500);
    }).catch(() => {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = query;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            const btn = document.getElementById('copyQueryBtn');
            btn.classList.add('copied');
            showToast('查询语句已复制', 'success');
            setTimeout(() => {
                btn.classList.remove('copied');
            }, 1500);
        } catch (e) {
            showToast('复制失败', 'error');
        }
        document.body.removeChild(textarea);
    });
};

// ==================== 收藏 UI 辅助函数 ====================

/**
 * 启动内联名称编辑模式
 * @param {number} idx - 渲染索引
 * @param {object} entry - 收藏条目
 * @param {HTMLElement} editBtn - 编辑按钮元素
 */
function _startInlineNameEdit(idx, entry, editBtn) {
    const nameEl = document.querySelector(`.fav-name[data-name-index="${idx}"]`);
    if (!nameEl) return;
    const nameRow = nameEl.parentElement;
    const currentName = entry.name || '';
    nameRow.innerHTML = `
        <div class="fav-name-edit-row" data-name-edit-index="${idx}">
            <input type="text" class="fav-name-input" value="${escapeHtml(currentName)}" placeholder="${escapeHtml(entry.baseQuery)}">
            <button class="fav-name-save" title="保存">✓</button>
            <button class="fav-name-cancel" title="取消">✕</button>
        </div>`;
    const input = nameRow.querySelector('.fav-name-input');
    if (input) {
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newName = input.value.trim();
                if (newName) {
                    updateFavoriteName(entry.query, newName);
                    const searchText = document.getElementById('favSearchInput')?.value || '';
                    renderFavoritesList(searchText);
                    showToast('别名已更新', 'success');
                }
            } else if (e.key === 'Escape') {
                const searchText = document.getElementById('favSearchInput')?.value || '';
                renderFavoritesList(searchText);
            }
        });
    }
}

/**
 * 显示标签选择 popover
 * @param {HTMLElement} anchor - 锚点按钮
 * @param {object} entry - 收藏条目
 * @param {number} idx - 渲染索引
 */
async function _showTagPopover(anchor, entry, idx) {
    // 移除已有的 popover
    const existing = document.querySelector('.fav-tag-popover');
    if (existing) existing.remove();

    const currentTags = entry.tags || ['用户'];
    const popover = document.createElement('div');
    popover.className = 'fav-tag-popover';
    popover.dataset.baseQuery = entry.baseQuery;
    popover.dataset.index = idx;

    // === 标题 ===
    const title = document.createElement('div');
    title.className = 'fav-tag-popover-title';
    title.textContent = '选择分组标签';
    popover.appendChild(title);

    // === 快速筛选 ===
    const filterRow = document.createElement('div');
    filterRow.className = 'fav-tag-filter-row';
    filterRow.innerHTML = '<input type="text" class="fav-tag-filter-input" placeholder="筛选标签…">';
    popover.appendChild(filterRow);
    const filterInput = filterRow.querySelector('.fav-tag-filter-input');

    // === 新建分组（顶部） ===
    const customRow = document.createElement('div');
    customRow.className = 'fav-tag-custom-row';
    customRow.innerHTML = `
        <input type="text" class="fav-tag-custom-input" placeholder="新建分组…" maxlength="20">
        <button class="fav-tag-custom-add" title="添加">+</button>`;
    popover.appendChild(customRow);

    const customInput = customRow.querySelector('.fav-tag-custom-input');
    const customAdd = customRow.querySelector('.fav-tag-custom-add');

    // === 分隔线 ===
    const divider = document.createElement('div');
    divider.className = 'fav-tag-popover-divider';
    popover.appendChild(divider);

    // === 标签列表容器 ===
    const tagList = document.createElement('div');
    tagList.className = 'fav-tag-list';
    popover.appendChild(tagList);

    // 收集所有已知标签（FOFA_RULES + 当前收藏已使用的自定义标签）
    const allTags = new Set();
    const builtinTags = new Set();
    try {
        const { FOFA_RULES } = await import('./fofa-rules.js');
        FOFA_RULES.forEach(r => {
            if (Array.isArray(r.tags)) r.tags.forEach(t => { allTags.add(t); builtinTags.add(t); });
        });
    } catch {}
    // 加入当前用户所有收藏中出现的标签
    const { state } = await import('./config.js');
    state.favorites.forEach(f => {
        if (!f.system && Array.isArray(f.tags)) f.tags.forEach(t => allTags.add(t));
    });
    const sortedTags = [...allTags].sort();

    // 判断是否为自定义标签（非内置、非"用户"）
    const isCustomTag = (tag) => tag !== '用户' && !builtinTags.has(tag);

    // 渲染标签选项
    function renderTagOptions(filter) {
        tagList.innerHTML = '';
        const kw = (filter || '').trim().toLowerCase();
        const filtered = kw
            ? sortedTags.filter(t => t.toLowerCase().includes(kw))
            : sortedTags;
        if (filtered.length === 0) {
            tagList.innerHTML = '<div class="fav-tag-empty">无匹配标签</div>';
            return;
        }
        filtered.forEach(tag => {
            const isActive = currentTags.includes(tag);
            const custom = isCustomTag(tag);
            const row = document.createElement('div');
            row.className = 'fav-tag-option-row';

            const opt = document.createElement('button');
            opt.className = `fav-tag-option${isActive ? ' is-active' : ''}`;
            opt.dataset.tag = tag;
            opt.textContent = `#${tag}`;
            row.appendChild(opt);

            // 自定义标签：显示重命名按钮；取消当前规则标签直接点击标签本身即可
            if (custom) {
                const editBtn = document.createElement('button');
                editBtn.className = 'fav-tag-edit';
                editBtn.title = '重命名此分组标签（同步修改所有用户收藏）';
                editBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    row.classList.add('is-editing');
                    row.innerHTML = `
                        <input class="fav-tag-inline-input" value="${escapeHtml(tag)}" aria-label="重命名标签">
                        <button class="fav-tag-inline-save" title="保存">✓</button>
                        <button class="fav-tag-inline-cancel" title="取消">×</button>
                    `;

                    const input = row.querySelector('.fav-tag-inline-input');
                    const saveBtn = row.querySelector('.fav-tag-inline-save');
                    const cancelBtn = row.querySelector('.fav-tag-inline-cancel');
                    const commitRename = () => {
                        const newName = input.value.trim();
                        if (!newName || newName === tag) { renderTagOptions(filterInput.value); return; }

                        // 重命名是分组级操作：同步修改所有用户收藏里的同名自定义标签
                        const changed = renameCustomTag(tag, newName);
                        if (changed === 0) { renderTagOptions(filterInput.value); return; }

                        const s = document.getElementById('favSearchInput')?.value || '';
                        renderFavoritesList(s);

                        allTags.delete(tag);
                        allTags.add(newName);
                        sortedTags.length = 0;
                        sortedTags.push(...[...allTags].sort());
                        const idx = currentTags.indexOf(tag);
                        if (idx >= 0) currentTags[idx] = newName;
                        renderTagOptions(filterInput.value);
                    };
                    input.focus();
                    input.select();
                    saveBtn.addEventListener('click', (ev) => { ev.stopPropagation(); commitRename(); });
                    cancelBtn.addEventListener('click', (ev) => { ev.stopPropagation(); renderTagOptions(filterInput.value); });
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') { ev.preventDefault(); commitRename(); }
                        if (ev.key === 'Escape') { renderTagOptions(filterInput.value); }
                    });
                });
                row.appendChild(editBtn);
            }

            tagList.appendChild(row);
        });
    }
    renderTagOptions('');

    // 筛选输入实时过滤
    filterInput.addEventListener('input', () => renderTagOptions(filterInput.value));

    // === 直接事件：标签选项点击切换 ===
    tagList.addEventListener('click', (e) => {
        const opt = e.target.closest('.fav-tag-option');
        if (!opt) return;
        e.stopPropagation();
        const tag = opt.dataset.tag;
        const hasTag = currentTags.includes(tag);
        const newTags = hasTag
            ? currentTags.filter(t => t !== tag)
            : [...currentTags, tag];
        updateFavoriteTags(entry.query, newTags);
        const searchText = document.getElementById('favSearchInput')?.value || '';
        renderFavoritesList(searchText);
        // 更新 popover 内状态而非关闭
        currentTags.length = 0;
        currentTags.push(...newTags);
        renderTagOptions(filterInput.value);
    });

    // === 自定义标签添加 ===
    const addCustomTag = () => {
        const name = customInput.value.trim();
        if (!name) return;
        const newTags = [...currentTags, name];
        updateFavoriteTags(entry.query, newTags);
        const searchText = document.getElementById('favSearchInput')?.value || '';
        renderFavoritesList(searchText);
        popover.remove();
        document.removeEventListener('click', closeHandler);
    };
    customAdd.addEventListener('click', addCustomTag);
    customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        }
    });

    // 点击外部关闭
    const closeHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== anchor) {
            popover.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // 挂载到 fav-modal
    const modal = document.querySelector('.fav-modal');
    if (!modal) { anchor.parentElement.appendChild(popover); return; }

    const anchorRect = anchor.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    const popoverHeight = 320;

    let top = anchorRect.bottom - modalRect.top + 4;
    if (top + popoverHeight > modalRect.height - 8) {
        top = anchorRect.top - modalRect.top - popoverHeight - 4;
        if (top < 4) top = 4;
    }

    const left = Math.min(anchorRect.left - modalRect.left, modalRect.width - 228);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    modal.appendChild(popover);

    // 列表滚动时关闭 popover
    const favList = document.querySelector('.fav-list');
    const onScroll = () => { popover.remove(); favList?.removeEventListener('scroll', onScroll); };
    setTimeout(() => favList?.addEventListener('scroll', onScroll, { once: true }), 0);

    // 聚焦到筛选输入框
    setTimeout(() => filterInput.focus(), 50);
}
document.addEventListener('DOMContentLoaded', async () => {
    // 设置搜索按钮更新函数（用于筛选条件变化时更新按钮状态）
    setSearchButtonUpdater(updateSearchButtonState);

    // 注入 fetchResults 到 results.js（打破 search.js ↔ results.js 循环依赖）
    setFetchResults(fetchResults);

    // Tauri 桌面模式：禁用右键菜单和网页快捷键
    if (isTauri()) {
        // 禁用右键菜单，选中文字时自动复制
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                navigator.clipboard.writeText(selection.toString()).catch(() => {});
            }
        });

        // 禁用网页默认快捷键（保留系统级快捷键）
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;

            // 允许 Ctrl/Cmd+C（复制选中文字）
            if (ctrl && key === 'c') return;
            // 允许 Ctrl/Cmd+V（粘贴到输入框）
            if (ctrl && key === 'v') return;
            // 允许 Ctrl/Cmd+X（剪切输入框内容）
            if (ctrl && key === 'x') return;
            // 允许 Ctrl/Cmd+Z（撤销输入框操作）
            if (ctrl && key === 'z') return;
            // 允许 Ctrl/Cmd+A（在输入框内全选）
            if (ctrl && key === 'a' && e.target.matches('input, textarea')) return;

            // 允许系统级快捷键（macOS）
            if (e.metaKey) {
                // ⌘+Q - 退出应用
                if (key === 'q') return;
                // ⌘+M - 最小化窗口
                if (key === 'm') return;
                // ⌘+H - 隐藏应用
                if (key === 'h') return;
                // ⌘+W - 关闭窗口
                if (key === 'w') return;
                // ⌘+N - 新建窗口（如果支持）
                if (key === 'n') return;
                // ⌘+Tab - 切换应用（系统级）
                if (key === 'tab') return;
                // ⌘+, - 偏好设置（如果支持）
                if (key === ',') return;
                // ⌘+Space - Spotlight 搜索（系统级）
                if (key === ' ') return;
                // ⌘+⌥+H - 隐藏其他窗口
                if (e.altKey && key === 'h') return;
                // ⌘+⌃+F - 全屏
                if (e.ctrlKey && key === 'f') return;
            }

            // 允许 Ctrl+Q（Linux/Windows）
            if (e.ctrlKey && key === 'q') return;

            // 阻止其他 Ctrl/Cmd 组合键
            if (ctrl) {
                e.preventDefault();
                return;
            }

            // 阻止功能键
            if (['f5', 'f12'].includes(key) || e.key === 'F5' || e.key === 'F12') {
                e.preventDefault();
            }
        });
    }

    // 初始化 Tauri 桌面环境适配（Web 模式下为空操作）
    try {
        state.apiBaseUrl = await initTauriBridge();

        // 恢复上次保存的代理配置到 Rust 侧（仅在代理启用时恢复）
        if (isTauri()) {
            const { setRequestConfig } = await import('./tauri-bridge.js');
            try {
                const proxyResult = await restoreProxyOnStartup();
                if (proxyResult.restored) {
                    console.log('[Init] Proxy config restored:', proxyResult.host, proxyResult.port);
                } else {
                    console.log('[Init] Proxy not restored:', proxyResult.reason);
                }
            } catch (e) { console.warn('[Init] Failed to restore proxy config:', e); logWarn('proxy', '启动时恢复代理配置失败', { message: e.message || String(e) }); }

            // 恢复请求配置（User-Agent + 自定义 Headers）
            const savedUA = localStorage.getItem(STORAGE_KEYS.userAgent) || '';
            let savedHeaders = {};
            try { savedHeaders = JSON.parse(localStorage.getItem(STORAGE_KEYS.customHeaders) || '{}'); } catch {}
            if (savedUA || Object.keys(savedHeaders).length > 0) {
                try {
                    await setRequestConfig(savedUA, savedHeaders);
                    console.log('[Init] Request config restored');
                    logInfo('request', '启动时恢复请求配置成功', { userAgentPresent: !!savedUA, headerCount: Object.keys(savedHeaders).length });
                } catch (e) { console.warn('[Init] Failed to restore request config:', e); logWarn('request', '启动时恢复请求配置失败', { message: e.message || String(e) }); }
            }
        }
    } catch (e) {
        logError('init', 'Tauri/桌面环境初始化失败', { message: e.message || String(e), isTauri: isTauri() });
        if (isTauri()) {
            showToast('桌面环境初始化失败: ' + e.message, 'error');
        }
    }

    // 初始化 IndexedDB
    state.db = await initIndexedDB();
    if (state.db) {
        await clearExpiredCache();
    }

    // 从缓存加载账户信息到 state
    const cachedUserInfo = getCachedUserInfo();
    if (cachedUserInfo) {
        state.userInfo = cachedUserInfo;
    } else if (state.apiKey) {
        try {
            const data = await fetchAccountInfo();
            if (!data.error) {
                state.userInfo = data;
                setCachedUserInfo(data);
            }
        } catch (e) {
            // 静默处理，用户可手动刷新
        }
    }

    // 初始化 API Key
    if (state.apiKey) {
        document.getElementById('apiKeyInput').value = state.apiKey;
    } else {
        // 启动时如果没有配置 API Key，自动弹出提示
        showApiKeyModal();
    }

    // 初始化缓存开关状态
    const useCacheCheckbox = document.getElementById('useCache');
    useCacheCheckbox.checked = state.useCache;
    useCacheCheckbox.addEventListener('change', (e) => {
        state.useCache = e.target.checked;
        localStorage.setItem(STORAGE_KEYS.useCache, state.useCache);
        showToast(state.useCache ? '已启用缓存' : '已禁用缓存', 'info');
    });

    // 初始化统计概览自动加载开关
    const autoLoadStatsCheckbox = document.getElementById('autoLoadStats');
    autoLoadStatsCheckbox.checked = localStorage.getItem(STORAGE_KEYS.autoLoadStats) === 'true';
    autoLoadStatsCheckbox.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.autoLoadStats, e.target.checked);
        showToast(e.target.checked ? '搜索时将自动加载统计概览' : '已关闭自动加载统计概览', 'info');
    });

    // 初始化缓存时间配置
    const cacheTimeValue = document.getElementById('cacheTimeValue');
    const cacheTimeUnit = document.getElementById('cacheTimeUnit');

    cacheTimeValue.value = localStorage.getItem(STORAGE_KEYS.cacheTimeValue) || '1';
    cacheTimeUnit.value = localStorage.getItem(STORAGE_KEYS.cacheTimeUnit) || 'days';

    cacheTimeValue.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.cacheTimeValue, e.target.value);
        showToast(`缓存有效期已更新为 ${e.target.value} ${cacheTimeUnit.options[cacheTimeUnit.selectedIndex].text}`, 'success');
    });

    cacheTimeUnit.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.cacheTimeUnit, e.target.value);
        showToast(`缓存有效期已更新为 ${cacheTimeValue.value} ${e.target.options[e.target.selectedIndex].text}`, 'success');
    });

    // 初始化每页数量
    const pageSize = document.getElementById('pageSize');
    pageSize.value = localStorage.getItem(STORAGE_KEYS.pageSize) || '100';
    pageSize.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.pageSize, e.target.value);
    });

    // 初始化数据范围（合并原时间范围 + 结果模式）
    const dataRange = document.getElementById('dataRange');
    // 兼容旧配置：优先读取新的 dataRange，其次读取旧的 timeRange
    const savedDataRange = localStorage.getItem(STORAGE_KEYS.dataRange) || localStorage.getItem(STORAGE_KEYS.timeRange) || 'default';
    // 如果旧值是 after=xxx 格式，直接使用；如果是空字符串，映射为 default
    dataRange.value = savedDataRange === '' ? 'default' : savedDataRange;
    dataRange.addEventListener('change', (e) => {
        localStorage.setItem(STORAGE_KEYS.dataRange, e.target.value);
    });

    // 初始化字段选择器
    initFieldTags();

    // 初始化快速筛选
    initQuickFilters();

    // 种子化内置 FOFA 规则到收藏（仅首次）
    seedSystemRules();

    // 搜索框事件
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');

    searchInput.addEventListener('focus', () => {
        showSuggestions();
        searchClearBtn.classList.add('show');
    });
    searchInput.addEventListener('blur', () => {
        // 延迟隐藏，避免点击清除按钮时 blur 先触发
        setTimeout(() => {
            if (document.activeElement !== searchInput) {
                searchClearBtn.classList.remove('show');
            }
        }, 150);
    });
    searchInput.addEventListener('input', debounce(handleInputChange, 200));
    searchInput.addEventListener('input', updateSearchButtonState);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            doSearch();
        }
    });

    // 初始化搜索按钮状态
    updateSearchButtonState();
    // 初始化统计按钮状态
    updateStatsButtonState();

    // 搜索完成后同步更新统计按钮状态
    window.addEventListener('searchComplete', () => {
        updateStatsButtonState();
        // 启用复制查询按钮
        const copyBtn = document.getElementById('copyQueryBtn');
        if (copyBtn && state.currentQuery) {
            copyBtn.disabled = false;
        }
        // 同步更新收藏按钮状态
        updateFavoriteButtonState();
    });

    // 表格横向滚动阴影检测
    const tableContainer = document.getElementById('tableContainer');
    const tableWrapper = document.getElementById('tableWrapper');
    const scrollShadow = document.getElementById('tableScrollShadow');
    if (tableContainer && scrollShadow) {
        let tableScrollWidth = 0;
        let tableClientWidth = 0;
        let scrollShadowFrame = null;

        const refreshScrollShadowMetrics = () => {
            tableScrollWidth = tableContainer.scrollWidth;
            tableClientWidth = tableContainer.clientWidth;
        };

        const updateScrollShadow = () => {
            // 仅在表格可见时检测
            if (tableWrapper && tableWrapper.style.display === 'none') {
                scrollShadow.classList.remove('visible');
                return;
            }
            // scroll 期间只读 scrollLeft，宽度指标由内容变化/窗口变化时刷新，避免强制同步布局
            const hasOverflow = tableScrollWidth > tableClientWidth + 1;
            const isAtEnd = tableContainer.scrollLeft + tableClientWidth >= tableScrollWidth - 4;
            if (hasOverflow && !isAtEnd) {
                scrollShadow.classList.add('visible');
            } else {
                scrollShadow.classList.remove('visible');
            }
        };

        const scheduleScrollShadowUpdate = () => {
            if (scrollShadowFrame !== null) return;
            scrollShadowFrame = requestAnimationFrame(() => {
                scrollShadowFrame = null;
                updateScrollShadow();
            });
        };

        const refreshAndScheduleScrollShadowUpdate = () => {
            refreshScrollShadowMetrics();
            scheduleScrollShadowUpdate();
        };

        refreshAndScheduleScrollShadowUpdate();
        tableContainer.addEventListener('scroll', scheduleScrollShadowUpdate, { passive: true });
        // 使用 MutationObserver 监听表格内容变化
        const observer = new MutationObserver(() => {
            setTimeout(refreshAndScheduleScrollShadowUpdate, 150);
        });
        observer.observe(tableContainer, { childList: true, subtree: true, characterData: true });
        // 窗口大小变化时重新检测
        window.addEventListener('resize', refreshAndScheduleScrollShadowUpdate, { passive: true });
    }

    // 点击外部关闭建议
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-input-wrapper')) {
            hideSuggestions();
        }
    });

    // 点击遮罩层关闭弹窗
    ['apiKeyModal', 'cacheModal', 'usageModal', 'aboutModal', 'smartDownloadModal', 'settingsModal', 'iconHashModal', 'favoritesPanel'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                e.target.classList.remove('show');
            }
        });
    });

    // 导出设置开关自动保存
    const exportIncludeQueryToggle = document.getElementById('exportIncludeQuery');
    if (exportIncludeQueryToggle) {
        exportIncludeQueryToggle.addEventListener('change', () => {
            localStorage.setItem(STORAGE_KEYS.exportIncludeQuery, exportIncludeQueryToggle.checked);
        });
    }

    // 诊断日志设置
    const loggingEnabledToggle = document.getElementById('loggingEnabled');
    if (loggingEnabledToggle) {
        loggingEnabledToggle.addEventListener('change', () => {
            setLoggingEnabled(loggingEnabledToggle.checked);
            logInfo('settings', loggingEnabledToggle.checked ? '诊断日志已启用' : '诊断日志已关闭');
            renderLogViewer();
        });
    }
    const loggingLevelSelect = document.getElementById('loggingLevel');
    if (loggingLevelSelect) {
        loggingLevelSelect.addEventListener('change', () => {
            setLogLevel(loggingLevelSelect.value);
            logInfo('settings', `日志等级已设置为 ${loggingLevelSelect.value}`);
            renderLogViewer();
        });
    }
    document.getElementById('refreshLogsBtn')?.addEventListener('click', renderLogViewer);
    document.getElementById('clearLogsBtn')?.addEventListener('click', clearDiagnosticLogs);
    document.getElementById('exportLogsBtn')?.addEventListener('click', exportDiagnosticLogs);

    // 点击外部关闭账户信息面板
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('userInfoPanel');
        if (!panel.classList.contains('show')) return;
        if (panel.contains(e.target)) return;
        closeUserInfo();
    });

    // 事件委托：处理历史记录点击
    const suggestions = document.getElementById('suggestions');
    suggestions.addEventListener('click', function(e) {
        const deleteBtn = e.target.closest('.suggestion-delete');
        if (deleteBtn) {
            e.stopPropagation();
            const query = decodeURIComponent(deleteBtn.dataset.query);
            deleteHistoryItem(query);
            showSuggestions();
            return;
        }

        const item = e.target.closest('.suggestion-item');
        if (item) {
            const query = decodeURIComponent(item.dataset.query);
            window.selectSuggestion(query);
        }
    });

    // tooltip 智能定位：hover 时检测溢出并调整方向
    document.querySelectorAll('.tooltip-wrapper').forEach(wrapper => {
        wrapper.addEventListener('mouseenter', () => {
            const tip = wrapper.querySelector('.tooltip-content');
            if (!tip) return;
            tip.classList.remove('tip-left', 'tip-right');
            const rect = tip.getBoundingClientRect();
            if (rect.left < 8) {
                tip.classList.add('tip-left');
            } else if (rect.right > window.innerWidth - 8) {
                tip.classList.add('tip-right');
            }
        });
    });

    // 收藏面板事件委托：填充 / 删除
    const favoritesList = document.getElementById('favoritesList');
    if (favoritesList) {
        favoritesList.addEventListener('click', (e) => {
            // 填充按钮
            const fillBtn = e.target.closest('.fav-fill');
            if (fillBtn) {
                e.stopPropagation();
                const idx = parseInt(fillBtn.dataset.index, 10);
                const entry = getRenderedFavorite(idx);
                if (entry) fillFromFavorite(entry);
                return;
            }
            // 编辑按钮 — 内联编辑别名
            const editBtn = e.target.closest('.fav-edit-btn');
            if (editBtn) {
                e.stopPropagation();
                const idx = parseInt(editBtn.dataset.editIndex, 10);
                const entry = getRenderedFavorite(idx);
                if (entry && !entry.system) {
                    _startInlineNameEdit(idx, entry, editBtn);
                }
                return;
            }
            // 保存/取消内联编辑（事件委托在列表上）
            const saveBtn = e.target.closest('.fav-name-save');
            const cancelBtn = e.target.closest('.fav-name-cancel');
            if (saveBtn || cancelBtn) {
                e.stopPropagation();
                const row = e.target.closest('.fav-name-edit-row');
                const idx = parseInt(row?.dataset.nameEditIndex, 10);
                if (saveBtn && row) {
                    const input = row.querySelector('.fav-name-input');
                    const newName = input ? input.value.trim() : '';
                    const entry = getRenderedFavorite(idx);
                    if (entry && newName) {
                        updateFavoriteName(entry.query, newName);
                        const searchText = document.getElementById('favSearchInput')?.value || '';
                        renderFavoritesList(searchText);
                        showToast('别名已更新', 'success');
                    }
                } else if (cancelBtn) {
                    const searchText = document.getElementById('favSearchInput')?.value || '';
                    renderFavoritesList(searchText);
                }
                return;
            }
            // 用户自定义标签快捷移除（只影响当前规则）
            const tagRemoveBtn = e.target.closest('.fav-tag-chip-remove');
            if (tagRemoveBtn) {
                e.stopPropagation();
                const idx = parseInt(tagRemoveBtn.dataset.tagIndex, 10);
                const tag = tagRemoveBtn.dataset.tag;
                const entry = getRenderedFavorite(idx);
                if (entry && !entry.system && tag) {
                    const tags = Array.isArray(entry.tags) ? entry.tags : ['用户'];
                    updateFavoriteTags(entry.query, tags.filter(t => t !== tag));
                    const searchText = document.getElementById('favSearchInput')?.value || '';
                    renderFavoritesList(searchText);
                    updateFavCount();
                }
                return;
            }
            // 标签 "+" 按钮 — 打开标签选择 popover
            const tagAddBtn = e.target.closest('.fav-tag-add');
            if (tagAddBtn) {
                e.stopPropagation();
                const idx = parseInt(tagAddBtn.dataset.tagIndex, 10);
                const entry = getRenderedFavorite(idx);
                if (entry && !entry.system) {
                    _showTagPopover(tagAddBtn, entry, idx);
                }
                return;
            }
            const deleteBtn = e.target.closest('.fav-delete');
            if (deleteBtn) {
                e.stopPropagation();
                const idx = parseInt(deleteBtn.dataset.index, 10);
                const entry = getRenderedFavorite(idx);
                if (entry && entry.query && !entry.system) {
                    removeFavorite(entry.query);
                    showToast('已取消收藏', 'info');
                    const searchText = document.getElementById('favSearchInput')?.value || '';
                    renderFavoritesList(searchText);
                    updateFavoriteButtonState();
                    updateFavCount();
                }
                return;
            }
        });
    }

    // 收藏面板打开时更新计数
    const favPanel = document.getElementById('favoritesPanel');
    if (favPanel) {
        const observer = new MutationObserver(() => {
            if (favPanel.classList.contains('show')) {
                updateFavCount();
            }
        });
        observer.observe(favPanel, { attributes: true, attributeFilter: ['class'] });
    }

    // 标签筛选 chip 点击委托（chip 行由 renderFavoritesList 重新生成）
    const favChips = document.getElementById('favChips');
    if (favChips) {
        favChips.addEventListener('click', (e) => {
            const chip = e.target.closest('.fav-chip');
            if (!chip) return;
            const searchText = document.getElementById('favSearchInput')?.value || '';
            setActiveFavTag(chip.dataset.tag || null, searchText);
            // 选择标签后自动折叠 chip 行
            favChips.classList.remove('expanded');
            const toggle = document.getElementById('favChipsToggle');
            if (toggle) toggle.textContent = '展开 ▼';
        });
    }

    // 标签行展开/收起切换
    const favChipsToggle = document.getElementById('favChipsToggle');
    if (favChipsToggle) {
        favChipsToggle.addEventListener('click', () => {
            const chips = document.getElementById('favChips');
            if (!chips) return;
            const expanded = chips.classList.toggle('expanded');
            favChipsToggle.textContent = expanded ? '收起 ▲' : '展开 ▼';
        });
    }

    // ==================== 更新检测 ====================

    // 设置面板：恢复自动检测更新开关状态
    const autoCheckToggle = document.getElementById('autoCheckUpdate');
    if (autoCheckToggle) {
        autoCheckToggle.checked = state.autoCheckUpdate;
    }

    // 更新 About 弹窗中的版本号
    const aboutVersion = document.querySelector('.about-version');
    if (aboutVersion) {
        aboutVersion.textContent = `v${APP_VERSION}`;
    }

    // 启动时自动检测更新（延迟 2 秒，避免阻塞首屏）
    if (state.autoCheckUpdate) {
        setTimeout(() => autoCheckUpdate(), 2000);
    }

});

// 保存自动检测更新开关状态（非模块作用域，供 HTML onclick 调用）
function saveAutoCheckUpdate(enabled) {
    state.autoCheckUpdate = enabled;
    localStorage.setItem(STORAGE_KEYS.autoCheckUpdate, enabled);
    showToast(enabled ? '已开启自动检测更新' : '已关闭自动检测更新', 'info');
}
