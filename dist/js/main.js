// js/main.js - 主入口（初始化、事件绑定）

import { state, STORAGE_KEYS } from './config.js';
import { showToast, debounce } from './utils.js';
import { initTauriBridge, isTauri, openUrl } from './tauri-bridge.js';
import { initIndexedDB, clearExpiredCache, deleteHistoryItem, clearAllCache as clearAllCacheStorage, getCachedUserInfo, setCachedUserInfo, getUsageStats } from './storage.js';
import { showApiKeyModal, closeApiKeyModal, togglePasswordVisibility, saveApiKey,
         showCacheManager, closeCacheModal, initFieldTags, closeUserInfo, exportCacheData,
         toggleFieldsDropdown, toggleField, removeField,
         initQuickFilters, toggleFilters, toggleFilter, updateFilterOperator, updateFilterInput, removeFilter, clearAllFilters, getFilterQuery,
         restoreFiltersFromData,
         exportConfigToFile, importConfigFromFile, toggleAdvanced } from './ui.js';
import { doSearch, showSuggestions, hideSuggestions, handleInputChange, fetchResults } from './search.js';
import { getHistoryFilters } from './storage.js';
import { sortTable, goToPage, downloadCurrentPage, downloadAllPages, closeDownloadModal, startDownload, hideDownloadProgress, copyColumn } from './results.js';
import { showUserInfo, refreshUserInfo } from './user-info.js';
import { fetchAccountInfo } from './api.js';

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
window.downloadCurrentPage = downloadCurrentPage;
window.downloadAllPages = downloadAllPages;
window.closeDownloadModal = closeDownloadModal;
window.startDownload = startDownload;
window.hideDownloadProgress = hideDownloadProgress;
window.openUrl = openUrl;
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
window.sortTable = sortTable;
window.copyColumn = copyColumn;
window.goToPage = goToPage;
window.toggleAdvanced = toggleAdvanced;

// 使用统计弹窗
window.showUsageStats = () => {
    const stats = getUsageStats();
    const now = new Date();
    const monthStr = `${now.getFullYear()}年${now.getMonth() + 1}月`;

    document.getElementById('usageMonth').textContent = `${monthStr} 使用情况`;
    document.getElementById('usageApiCalls').textContent = stats.apiCalls.toLocaleString();
    document.getElementById('usageDownloads').textContent = stats.downloads.toLocaleString();
    document.getElementById('usageFPoints').textContent = stats.fPoints.toLocaleString();
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
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
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

        // 禁用网页默认快捷键
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

            // 阻止所有 Ctrl/Cmd 组合键
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
    } catch (e) {
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
    }

    // 初始化缓存开关状态
    const useCacheCheckbox = document.getElementById('useCache');
    useCacheCheckbox.checked = state.useCache;
    useCacheCheckbox.addEventListener('change', (e) => {
        state.useCache = e.target.checked;
        localStorage.setItem(STORAGE_KEYS.useCache, state.useCache);
        showToast(state.useCache ? '已启用缓存' : '已禁用缓存', 'info');
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
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            doSearch();
        }
    });

    // 点击外部关闭建议
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-input-wrapper')) {
            hideSuggestions();
        }
    });

    // 点击遮罩层关闭弹窗
    ['apiKeyModal', 'cacheModal', 'usageModal', 'aboutModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                e.target.classList.remove('show');
            }
        });
    });

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



});
