// js/ui.js - UI 交互（弹窗、提示、字段选择）

import { state, STORAGE_KEYS, FIELD_LABELS, DEFAULT_FIELDS, FIELDS_CONFIG, FILTERS_CONFIG, VIP_LEVEL_MAP } from './config.js';
import { showToast, formatCacheExpiry, escapeHtml } from './utils.js';
import { clearAllCache, getCacheStats, getCachedQueries, getAllCachedData, exportToCSV, exportToJSON } from './storage.js';

// ==================== API Key 管理 ====================
export function showApiKeyModal() {
    document.getElementById('apiKeyModal').classList.add('show');
    document.getElementById('apiKeyInput').focus();
}

export function closeApiKeyModal() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const eyeIcon = document.getElementById('eyeIcon');
    // 重置为密码隐藏状态
    apiKeyInput.type = 'password';
    eyeIcon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    `;
    document.getElementById('apiKeyModal').classList.remove('show');
}

export function togglePasswordVisibility() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const eyeIcon = document.getElementById('eyeIcon');

    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        eyeIcon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        apiKeyInput.type = 'password';
        eyeIcon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}

export function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    if (!apiKey) {
        showToast('请输入 API Key', 'error');
        return;
    }
    state.apiKey = apiKey;
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    closeApiKeyModal();
    showToast('API Key 保存成功', 'success');
}

// ==================== 配置导入导出 ====================
// 获取当前配置对象
function getConfigObject() {
    return {
        version: 2,
        exportTime: new Date().toISOString(),
        data: {
            apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || '',
            searchHistory: localStorage.getItem(STORAGE_KEYS.searchHistory) || '[]',
            selectedFields: localStorage.getItem(STORAGE_KEYS.selectedFields) || '[]',
            useCache: localStorage.getItem(STORAGE_KEYS.useCache) || 'true',
            cacheTimeValue: localStorage.getItem(STORAGE_KEYS.cacheTimeValue) || '1',
            cacheTimeUnit: localStorage.getItem(STORAGE_KEYS.cacheTimeUnit) || 'days',
            pageSize: localStorage.getItem(STORAGE_KEYS.pageSize) || '100',
            dataRange: localStorage.getItem(STORAGE_KEYS.dataRange) || 'default',
            activeFilters: localStorage.getItem(STORAGE_KEYS.activeFilters) || '{}'
        }
    };
}

// 导出配置到文件（Base64 编码的 txt 文件）
export function exportConfigToFile() {
    const config = getConfigObject();
    const jsonStr = JSON.stringify(config);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `fofa_config_${timestamp}.txt`;

    const blob = new Blob([base64], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`配置已导出到 ${filename}`, 'success');
}

// 从文件导入配置（支持 Base64 编码的 txt 或 JSON 文件）
export function importConfigFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = event.target.result.trim();
                let config;

                // 尝试作为 Base64 解码
                try {
                    const jsonStr = decodeURIComponent(escape(atob(content)));
                    config = JSON.parse(jsonStr);
                } catch {
                    // 如果 Base64 解码失败，尝试直接作为 JSON 解析
                    config = JSON.parse(content);
                }

                applyConfig(config, file.name);
            } catch (err) {
                showToast('配置文件格式无效', 'error');
            }
        };
        reader.readAsText(file);
    };

    input.click();
}

// 应用配置到 localStorage
function applyConfig(config, source) {
    if (!config.version || !config.data) {
        showToast('无效的配置数据', 'error');
        return;
    }

    const { data } = config;

    // 恢复配置到 localStorage
    if (data.apiKey) localStorage.setItem(STORAGE_KEYS.apiKey, data.apiKey);
    if (data.searchHistory) localStorage.setItem(STORAGE_KEYS.searchHistory, data.searchHistory);
    if (data.selectedFields) localStorage.setItem(STORAGE_KEYS.selectedFields, data.selectedFields);
    if (data.useCache) localStorage.setItem(STORAGE_KEYS.useCache, data.useCache);
    if (data.cacheTimeValue) localStorage.setItem(STORAGE_KEYS.cacheTimeValue, data.cacheTimeValue);
    if (data.cacheTimeUnit) localStorage.setItem(STORAGE_KEYS.cacheTimeUnit, data.cacheTimeUnit);
    if (data.pageSize) localStorage.setItem(STORAGE_KEYS.pageSize, data.pageSize);
    if (data.activeFilters) localStorage.setItem(STORAGE_KEYS.activeFilters, data.activeFilters);

    // 兼容新旧配置：v2 使用 dataRange，v1 使用 timeRange + resultMode
    if (data.dataRange) {
        localStorage.setItem(STORAGE_KEYS.dataRange, data.dataRange);
    } else if (data.timeRange !== undefined) {
        // 旧配置迁移：空字符串映射为 default，其他保留
        localStorage.setItem(STORAGE_KEYS.dataRange, data.timeRange || 'default');
    }

    showToast(`配置从 ${source} 导入成功，页面将刷新`, 'success');

    // 刷新页面以应用配置
    setTimeout(() => {
        window.location.reload();
    }, 1000);
}

// ==================== 缓存管理 ====================
export async function showCacheManager() {
    const modal = document.getElementById('cacheModal');
    modal.classList.add('show');

    const stats = await getCacheStats();
    document.getElementById('cacheCount').textContent = stats.count;
    document.getElementById('cacheExpiry').textContent = formatCacheExpiry();

    // 加载查询语句列表
    await loadExportQueryList();
}

export function closeCacheModal() {
    document.getElementById('cacheModal').classList.remove('show');
}

// 加载导出查询语句下拉列表
async function loadExportQueryList() {
    const select = document.getElementById('exportQuerySelect');
    if (!select) return;

    const queries = await getCachedQueries();

    // 保留第一个选项，清空其余
    select.innerHTML = '<option value="">全部缓存数据</option>';

    queries.forEach(item => {
        const option = document.createElement('option');
        option.value = item.query;
        // 截断过长的查询语句
        const displayQuery = item.query.length > 50
            ? item.query.substring(0, 50) + '...'
            : item.query;
        option.textContent = `${displayQuery} (${item.count}条)`;
        select.appendChild(option);
    });
}

// 导出缓存数据
export async function exportCacheData(format) {
    const select = document.getElementById('exportQuerySelect');
    const queryFilter = select ? select.value : null;

    showToast('正在准备导出数据...', 'info');

    const cachedEntries = await getAllCachedData(queryFilter || null);

    if (!cachedEntries || cachedEntries.length === 0) {
        showToast('没有可导出的缓存数据', 'error');
        return;
    }

    // 合并所有查询结果
    let allResults = [];
    let exportInfo = {
        exportTime: new Date().toISOString(),
        queryFilter: queryFilter || '全部',
        totalEntries: cachedEntries.length
    };

    cachedEntries.forEach(entry => {
        if (entry.data && entry.data.results) {
            // 添加来源查询信息
            const resultsWithQuery = entry.data.results.map(row => ({
                _query: entry.query,
                _cachedTime: new Date(entry.timestamp).toLocaleString(),
                ...row
            }));
            allResults.push(...resultsWithQuery);
        }
    });

    if (allResults.length === 0) {
        showToast('缓存中没有结果数据', 'error');
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    let success = false;

    if (format === 'csv') {
        const filename = `fofa_export_${timestamp}.csv`;
        success = exportToCSV(allResults, filename);
    } else {
        const filename = `fofa_export_${timestamp}.json`;
        success = exportToJSON({
            info: exportInfo,
            data: allResults
        }, filename);
    }

    if (success) {
        showToast(`成功导出 ${allResults.length} 条数据`, 'success');
    } else {
        showToast('导出失败', 'error');
    }
}

// ==================== 用户信息面板 ====================
export function closeUserInfo() {
    document.getElementById('userInfoPanel').classList.remove('show');
}

// ==================== 字段选择 ====================
// 获取当前用户的 VIP 等级（用于字段权限判断）
function getUserVipLevel() {
    // 优先从 state.userInfo 读取（已初始化）
    if (state.userInfo) {
        if (state.userInfo.isvip) {
            // VIP 用户：返回 vip_level，如果映射中没有则返回 5（企业级权限）
            const level = state.userInfo.vip_level || 0;
            return VIP_LEVEL_MAP[level] ? level : 5;
        }
        return 0;
    }

    // 降级：从 localStorage 缓存读取
    try {
        const cached = localStorage.getItem(STORAGE_KEYS.userInfo);
        if (cached) {
            const { data } = JSON.parse(cached);
            if (data.isvip) {
                const level = data.vip_level || 0;
                return VIP_LEVEL_MAP[level] ? level : 5;
            }
            return 0;
        }
    } catch (e) {}
    return 0;
}

// 初始化字段选择器
export function initFieldTags() {
    const vipLevel = getUserVipLevel();
    const menu = document.getElementById('fieldsDropdownMenu');

    // 动态生成字段选项
    let html = '';
    let currentGroup = '';

    FIELDS_CONFIG.forEach(f => {
        // 根据权限等级分组显示
        const group = f.level === 0 ? '免费' : (f.desc || VIP_LEVEL_MAP[f.level]);
        if (group !== currentGroup) {
            if (currentGroup) {
                html += '<div style="height: 1px; background: var(--border); margin: 4px 0;"></div>';
            }
            currentGroup = group;
        }

        const disabled = f.level > vipLevel;
        const disabledClass = disabled ? 'disabled' : '';
        const disabledAttr = disabled ? 'onclick="return false"' : `onclick="toggleField(this)"`;
        const lockIcon = disabled ? ' <span style="font-size: 10px; opacity: 0.5;">🔒</span>' : '';

        html += `
            <div class="field-option ${disabledClass}" data-field="${f.field}" data-level="${f.level}" ${disabledAttr}>
                <span class="checkbox"></span>
                <span>${f.label}${lockIcon}</span>
            </div>
        `;
    });

    menu.innerHTML = html;

    // 从 localStorage 加载已选字段，如果没有则使用默认值
    const savedFields = localStorage.getItem(STORAGE_KEYS.selectedFields);
    let selectedFields = savedFields ? JSON.parse(savedFields) : DEFAULT_FIELDS;

    // 过滤掉当前权限不可用的字段
    selectedFields = selectedFields.filter(field => {
        const config = FIELDS_CONFIG.find(f => f.field === field);
        return config && config.level <= vipLevel;
    });

    // 更新下拉菜单中的选中状态
    updateDropdownSelection(selectedFields);
    // 更新已选标签显示
    updateSelectedTags(selectedFields);
    // 更新下拉按钮文本
    updateDropdownText(selectedFields);

    // 保存过滤后的字段
    if (savedFields) {
        localStorage.setItem(STORAGE_KEYS.selectedFields, JSON.stringify(selectedFields));
    }

    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('fieldsDropdownMenu');
        const btn = document.getElementById('fieldsDropdownBtn');
        if (dropdown && !dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.remove('show');
            btn.classList.remove('open');
        }
    });
}

// 切换下拉菜单显示
export function toggleFieldsDropdown() {
    const dropdown = document.getElementById('fieldsDropdownMenu');
    const btn = document.getElementById('fieldsDropdownBtn');
    dropdown.classList.toggle('show');
    btn.classList.toggle('open');
}

// 切换字段选中状态
export function toggleField(optionEl) {
    optionEl.classList.toggle('selected');

    // 获取当前所有选中的字段
    const selectedFields = getSelectedFieldsArray();

    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEYS.selectedFields, JSON.stringify(selectedFields));

    // 更新已选标签显示
    updateSelectedTags(selectedFields);
    // 更新下拉按钮文本
    updateDropdownText(selectedFields);
}

// 移除字段
export function removeField(field) {
    // 更新下拉菜单中的选中状态
    const option = document.querySelector(`.field-option[data-field="${field}"]`);
    if (option) {
        option.classList.remove('selected');
    }

    // 获取当前所有选中的字段
    const selectedFields = getSelectedFieldsArray();

    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEYS.selectedFields, JSON.stringify(selectedFields));

    // 更新已选标签显示
    updateSelectedTags(selectedFields);
    // 更新下拉按钮文本
    updateDropdownText(selectedFields);
}

// 获取选中字段数组
function getSelectedFieldsArray() {
    const selectedOptions = document.querySelectorAll('.field-option.selected');
    return Array.from(selectedOptions).map(opt => opt.dataset.field);
}

// 更新下拉菜单选中状态
function updateDropdownSelection(fields) {
    document.querySelectorAll('.field-option').forEach(option => {
        if (fields.includes(option.dataset.field)) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}

// 更新已选标签显示
function updateSelectedTags(fields) {
    const container = document.getElementById('selectedFieldsTags');
    if (!container) return;

    container.innerHTML = fields.map(field => `
        <span class="field-tag-small">
            ${escapeHtml(FIELD_LABELS[field] || field)}
            <span class="remove-field" data-field="${escapeHtml(field)}">&times;</span>
        </span>
    `).join('');

    // 事件委托：点击移除字段
    if (!container._delegated) {
        container.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-field');
            if (removeBtn) {
                removeField(removeBtn.dataset.field);
            }
        });
        container._delegated = true;
    }
}

// 更新下拉按钮文本
function updateDropdownText(fields) {
    const textEl = document.getElementById('fieldsDropdownText');
    if (!textEl) return;

    if (fields.length === 0) {
        textEl.textContent = '未选择字段';
    } else if (fields.length <= 3) {
        textEl.textContent = fields.map(f => FIELD_LABELS[f] || f).join('、');
    } else {
        textEl.textContent = `已选择 ${fields.length} 个字段`;
    }
}

// 获取选中字段字符串（用于 API 调用）
export function getSelectedFields() {
    const fields = getSelectedFieldsArray();
    return fields.length > 0 ? fields.join(',') : DEFAULT_FIELDS.join(',');
}

// ==================== 快速筛选 ====================
// 当前激活的筛选条件
const activeFilters = new Map();

// 获取所有筛选配置的扁平数组
function getAllFilters() {
    return [
        ...(FILTERS_CONFIG.general || []),
        ...(FILTERS_CONFIG.generalBool || []),
        ...(FILTERS_CONFIG.labels || []),
        ...(FILTERS_CONFIG.labelsBool || []),
        ...(FILTERS_CONFIG.protocol || []),
        ...(FILTERS_CONFIG.website || []),
        ...(FILTERS_CONFIG.location || []),
        ...(FILTERS_CONFIG.certBool || []),
        ...(FILTERS_CONFIG.cert || []),
        ...(FILTERS_CONFIG.time || []),
        ...(FILTERS_CONFIG.ipFilter || [])
    ];
}

// 初始化快速筛选
export function initQuickFilters() {
    const vipLevel = getUserVipLevel();
    const container = document.getElementById('filterCategories');
    if (!container) return;

    let html = '';

    // 基础类
    html += renderFilterSection('基础查询', FILTERS_CONFIG.general, vipLevel, 'input');
    html += renderFilterSection('基础筛选', FILTERS_CONFIG.generalBool, vipLevel, 'bool');

    // 标记类
    html += renderFilterSection('应用/产品', FILTERS_CONFIG.labels, vipLevel, 'input');
    html += renderFilterSection('资产标记', FILTERS_CONFIG.labelsBool, vipLevel, 'bool');

    // 协议类
    html += renderFilterSection('协议筛选', FILTERS_CONFIG.protocol, vipLevel, 'mixed');

    // 网站类
    html += renderFilterSection('网站筛选', FILTERS_CONFIG.website, vipLevel, 'input');

    // 地理位置
    html += renderFilterSection('地理位置', FILTERS_CONFIG.location, vipLevel, 'input');

    // 证书类
    html += renderFilterSection('证书状态', FILTERS_CONFIG.certBool, vipLevel, 'bool');
    html += renderFilterSection('证书查询', FILTERS_CONFIG.cert, vipLevel, 'input');

    // 时间类
    html += renderFilterSection('时间筛选', FILTERS_CONFIG.time, vipLevel, 'input');

    // 独立IP类
    html += renderFilterSection('独立IP筛选', FILTERS_CONFIG.ipFilter, vipLevel, 'input');

    container.innerHTML = html;
}

// 渲染筛选区块
function renderFilterSection(title, filters, vipLevel, type) {
    if (!filters || filters.length === 0) return '';

    let html = `<div class="filter-category"><div class="filter-category-title">${title}</div>`;

    if (type === 'input') {
        html += '<div class="filter-inputs">';
        filters.forEach(filter => {
            const disabled = filter.level > vipLevel;
            const lockIcon = disabled ? ' <span class="lock-icon">🔒</span>' : '';
            const desc = filter.desc ? ` <span style="font-size:10px;color:var(--text-secondary)">(${filter.desc})</span>` : '';

            // 操作符选择器
            let operatorHtml = '';
            if (filter.operators && filter.operators.length > 0) {
                operatorHtml = `<select class="filter-operator" data-key="${filter.key}" data-field="${filter.key}" onchange="updateFilterOperator('${filter.key}', this.value)" ${disabled ? 'disabled' : ''}>`;
                filter.operators.forEach(op => {
                    operatorHtml += `<option value="${op}">${op}</option>`;
                });
                operatorHtml += '</select>';
            }

            html += `
                <div class="filter-input-group${filter.operators ? ' has-operator' : ''}">
                    <label>${filter.label}${lockIcon}${desc}</label>
                    <div class="filter-input-wrapper">
                        ${operatorHtml}
                        <input type="${filter.type}" placeholder="${filter.placeholder || ''}" data-key="${filter.key}"
                            ${disabled ? 'disabled' : ''} onchange="updateFilterInput('${filter.key}', this.value)">
                    </div>
                </div>
            `;
        });
        html += '</div>';
    } else if (type === 'bool') {
        html += '<div class="filter-tags">';
        filters.forEach(filter => {
            const disabled = filter.level > vipLevel;
            const disabledClass = disabled ? 'disabled' : '';
            const desc = filter.desc ? `(${filter.desc})` : '';

            const trueKey = `${filter.key}_true`;
            const falseKey = `${filter.key}_false`;
            html += `<div class="filter-tag ${disabledClass}" data-key="${trueKey}" data-filter="${filter.key}" data-value="true" onclick="toggleFilter(this, '${trueKey}')">${filter.trueLabel}${disabled ? ' 🔒' : ''}</div>`;
            html += `<div class="filter-tag ${disabledClass}" data-key="${falseKey}" data-filter="${filter.key}" data-value="false" onclick="toggleFilter(this, '${falseKey}')">${filter.falseLabel}${disabled ? ' 🔒' : ''}</div>`;
        });
        html += '</div>';
    } else if (type === 'mixed') {
        html += '<div class="filter-tags" style="margin-bottom: 8px;">';
        filters.forEach(filter => {
            if (filter.options) {
                const disabled = filter.level > vipLevel;
                const disabledClass = disabled ? 'disabled' : '';
                filter.options.forEach((opt, idx) => {
                    const key = `${filter.key}_${opt}`;
                    html += `<div class="filter-tag ${disabledClass}" data-key="${key}" data-filter="${filter.key}" data-value="${opt}" onclick="toggleFilter(this, '${key}')">${filter.optionLabels[idx]}${disabled ? ' 🔒' : ''}</div>`;
                });
            }
        });
        html += '</div>';
        html += '<div class="filter-inputs">';
        filters.forEach(filter => {
            if (filter.type && !filter.options) {
                const disabled = filter.level > vipLevel;
                const lockIcon = disabled ? ' <span class="lock-icon">🔒</span>' : '';

                // 操作符选择器
                let operatorHtml = '';
                if (filter.operators && filter.operators.length > 0) {
                    operatorHtml = `<select class="filter-operator" data-key="${filter.key}" data-field="${filter.key}" onchange="updateFilterOperator('${filter.key}', this.value)" ${disabled ? 'disabled' : ''}>`;
                    filter.operators.forEach(op => {
                        operatorHtml += `<option value="${op}">${op}</option>`;
                    });
                    operatorHtml += '</select>';
                }

                html += `
                    <div class="filter-input-group${filter.operators ? ' has-operator' : ''}">
                        <label>${filter.label}${lockIcon}</label>
                        <div class="filter-input-wrapper">
                            ${operatorHtml}
                            <input type="${filter.type}" placeholder="${filter.placeholder || ''}" data-key="${filter.key}"
                                ${disabled ? 'disabled' : ''} onchange="updateFilterInput('${filter.key}', this.value)">
                        </div>
                    </div>
                `;
            }
        });
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// 切换筛选面板显示
export function toggleFilters() {
    const panel = document.getElementById('quickFiltersPanel');
    const btn = document.getElementById('filterToggleBtn');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    if (btn) {
        btn.classList.toggle('btn-primary', !isVisible);
    }
}

// 切换高级选项显示
export function toggleAdvanced() {
    const panel = document.getElementById('advancedOptions');
    panel.classList.toggle('show');
}

// 切换筛选条件（布尔/选项类型）
export function toggleFilter(el, key) {
    if (el.classList.contains('disabled')) return;

    el.classList.toggle('active');

    if (el.classList.contains('active')) {
        const filter = el.dataset.filter;
        const value = el.dataset.value;
        activeFilters.set(key, { filter, value });
    } else {
        activeFilters.delete(key);
    }

    updateActiveFiltersDisplay();
}

// 更新操作符
export function updateFilterOperator(key, operator) {
    const existing = activeFilters.get(key);
    if (existing) {
        existing.operator = operator;
        activeFilters.set(key, existing);
        updateActiveFiltersDisplay();
    }
}

// 更新输入框筛选
export function updateFilterInput(key, value) {
    // 获取当前操作符
    const operatorSelect = document.querySelector(`.filter-operator[data-key="${key}"]`);
    const operator = operatorSelect ? operatorSelect.value : '=';

    if (value.trim()) {
        activeFilters.set(key, { filter: key, value: value.trim(), operator });
    } else {
        activeFilters.delete(key);
    }

    updateActiveFiltersDisplay();
}

// 移除筛选条件
export function removeFilter(key) {
    activeFilters.delete(key);

    // 更新标签状态
    const tag = document.querySelector(`.filter-tag[data-key="${key}"]`);
    if (tag) {
        tag.classList.remove('active');
    }

    // 更新输入框状态
    const input = document.querySelector(`input[data-key="${key}"]`);
    if (input) {
        input.value = '';
    }

    updateActiveFiltersDisplay();
}

// 重置所有筛选 UI 状态（共享逻辑）
function resetFilterUI() {
    activeFilters.clear();
    document.querySelectorAll('.filter-tag.active').forEach(tag => {
        tag.classList.remove('active');
    });
    document.querySelectorAll('.filter-inputs input[data-key]').forEach(input => {
        input.value = '';
    });
    document.querySelectorAll('.filter-operator').forEach(select => {
        select.value = '=';
    });
}

// 清除所有筛选条件
export function clearAllFilters() {
    resetFilterUI();
    updateActiveFiltersDisplay();
    showToast('已清除所有筛选条件', 'info');
}

// 从历史数据恢复筛选条件
export function restoreFiltersFromData(filtersData) {
    if (!filtersData || typeof filtersData !== 'object') return;

    // 先清除当前筛选
    resetFilterUI();

    // 恢复筛选条件
    Object.entries(filtersData).forEach(([key, data]) => {
        // 验证 key 是否对应有效的 DOM 元素
        const tag = document.querySelector(`.filter-tag[data-key="${key}"]`);
        const input = document.querySelector(`input[data-key="${key}"]`);
        if (!tag && !input) return; // 跳过孤立的筛选条件

        activeFilters.set(key, data);

        // 恢复标签状态
        if (tag) {
            tag.classList.add('active');
        }

        // 恢复输入框状态
        if (input) {
            input.value = data.value;
        }

        // 恢复操作符状态
        if (data.operator) {
            const operatorSelect = document.querySelector(`.filter-operator[data-key="${key}"]`);
            if (operatorSelect) {
                operatorSelect.value = data.operator;
            }
        }
    });

    updateActiveFiltersDisplay();
}

// 获取当前激活的筛选条件数据（用于保存到历史）
export function getActiveFiltersData() {
    const filtersObj = {};
    activeFilters.forEach((data, key) => {
        filtersObj[key] = data;
    });
    return filtersObj;
}

// 更新已激活筛选显示
function updateActiveFiltersDisplay() {
    const container = document.getElementById('activeFilters');
    if (!container) return;

    if (activeFilters.size === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    let html = '';

    const allFilters = getAllFilters();

    activeFilters.forEach((data, key) => {
        let label = key;
        const config = allFilters.find(f => key === f.key || key === `${f.key}_true` || key === `${f.key}_false`)
            || allFilters.find(f => key.startsWith(f.key + '_'));
        if (config) {
            if (config.options) {
                const idx = config.options.indexOf(data.value);
                label = `${config.label}: ${config.optionLabels[idx]}`;
            } else if (config.trueLabel) {
                label = `${config.label}: ${data.value === 'true' ? config.trueLabel : config.falseLabel}`;
            } else {
                const op = data.operator || '=';
                label = `${config.label} ${op} ${data.value}`;
            }
        }

        html += `
            <span class="active-filter-tag">
                ${escapeHtml(label)}
                <span class="remove-filter" data-key="${escapeHtml(key)}">&times;</span>
            </span>
        `;
    });

    html += `
        <span class="active-filter-tag active-filter-clear" data-action="clear-all">
            清除全部
        </span>
    `;

    container.innerHTML = html;

    // 事件委托：移除单个筛选
    if (!container._delegated) {
        container.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-filter');
            if (removeBtn) {
                removeFilter(removeBtn.dataset.key);
                return;
            }
            if (e.target.closest('[data-action="clear-all"]')) {
                clearAllFilters();
            }
        });
        container._delegated = true;
    }
}

// 获取筛选查询字符串
export function getFilterQuery() {
    const parts = [];

    activeFilters.forEach((data, key) => {
        if (data.value === 'true' || data.value === 'false') {
            // 布尔类型
            parts.push(`${data.filter}=${data.value}`);
        } else if (data.filter === key) {
            // 输入框类型 - 使用操作符
            const op = data.operator || '=';
            parts.push(`${data.filter}${op}"${data.value}"`);
        } else {
            // 选项类型
            parts.push(`${data.filter}="${data.value}"`);
        }
    });

    return parts.join(' && ');
}
