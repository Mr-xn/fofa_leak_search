// js/ui.js - UI 交互（弹窗、提示、字段选择）

import { state, STORAGE_KEYS, FIELD_LABELS, DEFAULT_FIELDS, FIELDS_CONFIG, FILTERS_CONFIG, VIP_LEVEL_MAP } from './config.js';
import { showToast, formatCacheExpiry, escapeHtml } from './utils.js';
import { clearAllCache, getCacheStats, getCachedQueries, getAllCachedData, exportToCSV, exportToJSON } from './storage.js';
import { setProxyConfig, getProxyConfig as getTauriProxyConfig, setRequestConfig, getRequestConfig } from './tauri-bridge.js';
import { getLogs, clearLogs, exportLogs, isLoggingEnabled, getLogLevel, info as logInfo, warn as logWarn } from './logger.js';

// 延迟导入 search.js 中的函数，避免循环依赖
let _updateSearchButtonState = null;
export function setSearchButtonUpdater(fn) {
    _updateSearchButtonState = fn;
}

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

// ==================== 设置弹窗 ====================
export function showSettingsModal() {
    const modal = document.getElementById('settingsModal');
    // 加载已保存的 API Key
    const savedKey = localStorage.getItem(STORAGE_KEYS.apiKey) || '';
    document.getElementById('settingsApiKeyInput').value = savedKey;
    document.getElementById('settingsApiKeyInput').type = 'password';
    // 重置眼睛图标
    const eyeIcon = document.getElementById('settingsEyeIcon');
    eyeIcon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    `;
    // 加载导出设置（默认关闭）
    const exportQuery = localStorage.getItem(STORAGE_KEYS.exportIncludeQuery);
    document.getElementById('exportIncludeQuery').checked = exportQuery === 'true';
    // 加载代理设置（优先从 localStorage，异步同步 Rust 侧）
    const proxyEnabled = localStorage.getItem(STORAGE_KEYS.proxyEnabled) !== 'false';
    const proxyEnabledCheckbox = document.getElementById('proxyEnabled');
    if (proxyEnabledCheckbox) proxyEnabledCheckbox.checked = proxyEnabled;
    toggleProxyEnabled(proxyEnabled);
    document.getElementById('proxyHost').value = localStorage.getItem(STORAGE_KEYS.proxyHost) || '';
    document.getElementById('proxyPort').value = localStorage.getItem(STORAGE_KEYS.proxyPort) || '';
    document.getElementById('proxyUsername').value = localStorage.getItem(STORAGE_KEYS.proxyUsername) || '';
    document.getElementById('proxyPassword').value = localStorage.getItem(STORAGE_KEYS.proxyPassword) || '';

    // 加载请求设置
    const savedUA = localStorage.getItem(STORAGE_KEYS.userAgent);
    document.getElementById('userAgent').value = savedUA || '';
    try {
        const savedHeaders = JSON.parse(localStorage.getItem(STORAGE_KEYS.customHeaders) || '{}');
        const headerLines = Object.entries(savedHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
        document.getElementById('customHeaders').value = headerLines;
    } catch { /* ignore parse error */ }
    document.getElementById('headerErrors').style.display = 'none';

    // 加载请求超时
    const savedTimeout = localStorage.getItem(STORAGE_KEYS.requestTimeout);
    document.getElementById('requestTimeout').value = savedTimeout || '30';

    // 异步从 Rust 侧获取最新代理配置
    getTauriProxyConfig().then(config => {
        if (config) {
            document.getElementById('proxyHost').value = config.host || '';
            document.getElementById('proxyPort').value = config.port || '';
            document.getElementById('proxyUsername').value = config.username || '';
            document.getElementById('proxyPassword').value = config.password || '';
        }
    }).catch(() => {});

    // 加载诊断日志设置
    const loggingEnabled = document.getElementById('loggingEnabled');
    const loggingLevel = document.getElementById('loggingLevel');
    if (loggingEnabled) loggingEnabled.checked = isLoggingEnabled();
    if (loggingLevel) loggingLevel.value = getLogLevel();
    renderLogViewer();

    // 异步从 Rust 侧获取最新请求配置
    getRequestConfig().then(config => {
        if (config) {
            document.getElementById('userAgent').value = config.user_agent || '';
            if (config.custom_headers) {
                const lines = Object.entries(config.custom_headers).map(([k, v]) => `${k}: ${v}`).join('\n');
                document.getElementById('customHeaders').value = lines;
            }
        }
    }).catch(() => {});

    modal.classList.add('show');
}

export function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

export function renderLogViewer() {
    const viewer = document.getElementById('logViewer');
    if (!viewer) return;
    const logs = getLogs().slice(-100).reverse();
    if (logs.length === 0) {
        viewer.innerHTML = '<div class="log-empty">日志未启用或暂无日志</div>';
        return;
    }
    viewer.innerHTML = logs.map(entry => `
        <div class="log-entry log-${escapeHtml(entry.level)}">
            <div class="log-entry-head">
                <span class="log-level">${escapeHtml(entry.level)}</span>
                <span class="log-module">${escapeHtml(entry.module)}</span>
                <span class="log-time">${escapeHtml(entry.time)}</span>
            </div>
            <div class="log-message">${escapeHtml(entry.message)}</div>
            ${entry.details ? `<pre class="log-details">${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>` : ''}
        </div>
    `).join('');
}

export function clearDiagnosticLogs() {
    clearLogs();
    renderLogViewer();
    showToast('诊断日志已清空', 'success');
}

export function exportDiagnosticLogs() {
    const content = exportLogs();
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    link.href = url;
    link.download = `fofa_logs_${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('诊断日志已导出', 'success');
}

export function saveSettingsApiKey() {
    const apiKey = document.getElementById('settingsApiKeyInput').value.trim();
    if (!apiKey) {
        showToast('请输入 API Key', 'error');
        return;
    }
    state.apiKey = apiKey;
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    showToast('API Key 保存成功', 'success');
}

export function toggleSettingsPassword() {
    const input = document.getElementById('settingsApiKeyInput');
    const eyeIcon = document.getElementById('settingsEyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
    } else {
        input.type = 'password';
        eyeIcon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        `;
    }
}

export async function saveProxySettings() {
    const enabledCheckbox = document.getElementById('proxyEnabled');
    const enabled = enabledCheckbox ? enabledCheckbox.checked : true;
    const host = document.getElementById('proxyHost').value.trim();
    const port = parseInt(document.getElementById('proxyPort').value.trim()) || 0;
    const username = document.getElementById('proxyUsername').value.trim();
    const password = document.getElementById('proxyPassword').value.trim();

    localStorage.setItem(STORAGE_KEYS.proxyEnabled, enabled.toString());
    localStorage.setItem(STORAGE_KEYS.proxyHost, host);
    localStorage.setItem(STORAGE_KEYS.proxyPort, port.toString());
    localStorage.setItem(STORAGE_KEYS.proxyUsername, username);
    localStorage.setItem(STORAGE_KEYS.proxyPassword, password);
    logInfo('proxy', '保存代理设置', {
        enabled,
        host,
        port,
        usernamePresent: !!username,
        passwordPresent: !!password
    });

    // 同步到 Rust 侧（Tauri 环境）
    // 开关关闭时发送空配置以清除 Rust 侧代理
    try {
        if (enabled) {
            const result = await setProxyConfig(host, port, username, password);
            console.log('[Proxy]', result);
            logInfo('proxy', '代理设置已同步到 Rust', { result });
        } else {
            const result = await setProxyConfig('', 0, '', '');
            console.log('[Proxy] 已禁用代理', result);
            logInfo('proxy', '代理已禁用，已清除 Rust 侧配置', { result });
        }
    } catch (e) {
        console.warn('[Proxy] 同步到 Rust 侧失败（非 Tauri 环境可忽略）:', e);
        logWarn('proxy', '代理设置同步到 Rust 失败', { message: e.message || String(e) });
    }

    if (!enabled) {
        showToast('代理已禁用', 'success');
    } else if (host && port) {
        showToast(`代理设置已保存: ${host}:${port}`, 'success');
    } else if (!host && !port) {
        showToast('代理设置已清除', 'success');
    } else {
        showToast('代理设置已保存（主机和端口需同时填写才生效）', 'info');
    }
}

/**
 * 启动时恢复代理配置到 Rust 侧
 * 读取 localStorage 中的 proxyEnabled 标志，只在启用时才恢复代理
 * @returns {Promise<{restored: boolean, host?: string, port?: number, reason?: string}>}
 */
export async function restoreProxyOnStartup() {
    const savedHost = localStorage.getItem(STORAGE_KEYS.proxyHost) || '';
    const savedPort = parseInt(localStorage.getItem(STORAGE_KEYS.proxyPort)) || 0;

    // 无配置：host 或 port 缺失
    if (!savedHost || !savedPort) {
        return { restored: false, reason: 'no-config' };
    }

    // 检查代理开关状态（无键时默认启用，向后兼容旧版本）
    const enabledRaw = localStorage.getItem(STORAGE_KEYS.proxyEnabled);
    const proxyEnabled = enabledRaw !== 'false';

    if (!proxyEnabled) {
        return { restored: false, reason: 'disabled' };
    }

    const savedUser = localStorage.getItem(STORAGE_KEYS.proxyUsername) || '';
    const savedPass = localStorage.getItem(STORAGE_KEYS.proxyPassword) || '';

    await setProxyConfig(savedHost, savedPort, savedUser, savedPass);
    logInfo('proxy', '启动时恢复代理配置成功', { host: savedHost, port: savedPort, usernamePresent: !!savedUser, passwordPresent: !!savedPass });

    return { restored: true, host: savedHost, port: savedPort };
}

/**
 * 代理开关联动：启用/禁用输入框和保存按钮文字
 * @param {boolean} enabled - 是否启用代理
 */
export function toggleProxyEnabled(enabled) {
    const grid = document.getElementById('proxyFieldsGrid');
    const fields = ['proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword'];
    const btn = document.getElementById('saveProxyBtn');

    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });

    if (grid) {
        if (enabled) {
            grid.classList.remove('proxy-disabled');
        } else {
            grid.classList.add('proxy-disabled');
        }
    }

    if (btn) {
        btn.textContent = enabled ? '保存代理设置' : '保存并禁用代理';
    }
}

// ==================== 请求设置（User-Agent + 自定义 Headers） ====================

// 默认 User-Agent
const DEFAULT_USER_AGENT = 'curl/8.21.0';

// 前端 header 校验（与 Rust 侧双重保障）
function validateCustomHeaders(text) {
    const errors = [];
    const forbidden = ['host', 'content-length', 'transfer-encoding',
        'connection', 'keep-alive', 'te', 'trailer',
        'upgrade', 'proxy-authorization', 'proxy-authenticate'];

    if (!text.trim()) return { headers: {}, errors: [] };

    const lines = text.split('\n');
    const headers = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
            errors.push(`第 ${i + 1} 行格式错误（缺少冒号）: ${line}`);
            continue;
        }

        const name = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();

        if (!name) {
            errors.push(`第 ${i + 1} 行 header 名称为空`);
            continue;
        }

        if (name.startsWith(':')) {
            errors.push(`第 ${i + 1} 行禁止伪头部: ${name}`);
            continue;
        }

        if (forbidden.includes(name.toLowerCase())) {
            errors.push(`第 ${i + 1} 行禁止手动设置: ${name}`);
            continue;
        }

        if (!/^[A-Za-z0-9\-_]+$/.test(name)) {
            errors.push(`第 ${i + 1} 行非法 header 名称（仅允许字母、数字、-、_）: ${name}`);
            continue;
        }

        if (/[\r\n]/.test(value)) {
            errors.push(`第 ${i + 1} 行 header 值包含非法换行符: ${name}`);
            continue;
        }

        if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) {
            errors.push(`第 ${i + 1} 行 header 值包含控制字符: ${name}`);
            continue;
        }

        headers[name] = value;
    }

    return { headers, errors };
}

export function resetUserAgent() {
    document.getElementById('userAgent').value = DEFAULT_USER_AGENT;
}

export async function saveRequestConfig() {
    const userAgent = document.getElementById('userAgent').value.trim();
    const customHeadersText = document.getElementById('customHeaders').value;
    const errorDiv = document.getElementById('headerErrors');

    // 前端校验
    const { headers, errors } = validateCustomHeaders(customHeadersText);
    if (errors.length > 0) {
        errorDiv.textContent = errors.join('\n');
        errorDiv.style.display = 'block';
        showToast('自定义 Headers 格式有误，请修正', 'error');
        return;
    }
    errorDiv.style.display = 'none';

    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEYS.userAgent, userAgent);
    localStorage.setItem(STORAGE_KEYS.customHeaders, JSON.stringify(headers));

    // 保存超时设置（秒，范围 5–300）
    const timeoutInput = document.getElementById('requestTimeout');
    const timeoutVal = parseInt(timeoutInput.value) || 30;
    const clampedTimeout = Math.max(5, Math.min(300, timeoutVal));
    localStorage.setItem(STORAGE_KEYS.requestTimeout, clampedTimeout.toString());
    timeoutInput.value = clampedTimeout;  // 回写修正后的值

    // 同步到 Rust 侧
    try {
        const result = await setRequestConfig(userAgent, headers);
        console.log('[RequestConfig]', result);
        showToast('请求设置已保存', 'success');
    } catch (e) {
        console.warn('[RequestConfig] 同步到 Rust 侧失败:', e);
        showToast('请求设置已保存（本地），Rust 同步失败: ' + (e.message || e), 'error');
    }
}

// ==================== 配置导入导出 ====================
// 获取当前配置对象（已导出供测试）
export function getConfigObject() {
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
            activeFilters: localStorage.getItem(STORAGE_KEYS.activeFilters) || '{}',
            exportIncludeQuery: localStorage.getItem(STORAGE_KEYS.exportIncludeQuery) || 'true',
            proxyEnabled: localStorage.getItem(STORAGE_KEYS.proxyEnabled) || 'true',
            proxyHost: localStorage.getItem(STORAGE_KEYS.proxyHost) || '',
            proxyPort: localStorage.getItem(STORAGE_KEYS.proxyPort) || '',
            proxyUsername: localStorage.getItem(STORAGE_KEYS.proxyUsername) || '',
            proxyPassword: localStorage.getItem(STORAGE_KEYS.proxyPassword) || '',
            userAgent: localStorage.getItem(STORAGE_KEYS.userAgent) || '',
            customHeaders: localStorage.getItem(STORAGE_KEYS.customHeaders) || '{}',
            favorites: localStorage.getItem(STORAGE_KEYS.favorites) || '[]',
            loggingEnabled: localStorage.getItem(STORAGE_KEYS.loggingEnabled) || 'false',
            loggingLevel: localStorage.getItem(STORAGE_KEYS.loggingLevel) || 'info',
            requestTimeout: localStorage.getItem(STORAGE_KEYS.requestTimeout) || '30'
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

// 应用配置到 localStorage（已导出供测试）
export function applyConfig(config, source) {
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
    if (data.loggingEnabled !== undefined) localStorage.setItem(STORAGE_KEYS.loggingEnabled, data.loggingEnabled);
    if (data.loggingLevel) localStorage.setItem(STORAGE_KEYS.loggingLevel, data.loggingLevel);
    if (data.requestTimeout) localStorage.setItem(STORAGE_KEYS.requestTimeout, data.requestTimeout);
    if (data.proxyEnabled !== undefined) localStorage.setItem(STORAGE_KEYS.proxyEnabled, data.proxyEnabled);
    if (data.proxyHost !== undefined) localStorage.setItem(STORAGE_KEYS.proxyHost, data.proxyHost);
    if (data.proxyPort !== undefined) localStorage.setItem(STORAGE_KEYS.proxyPort, data.proxyPort);
    if (data.proxyUsername !== undefined) localStorage.setItem(STORAGE_KEYS.proxyUsername, data.proxyUsername);
    if (data.proxyPassword !== undefined) localStorage.setItem(STORAGE_KEYS.proxyPassword, data.proxyPassword);

    // 兼容新旧配置：v2 使用 dataRange，v1 使用 timeRange + resultMode
    if (data.dataRange) {
        localStorage.setItem(STORAGE_KEYS.dataRange, data.dataRange);
    } else if (data.timeRange !== undefined) {
        // 旧配置迁移：空字符串映射为 default，其他保留
        localStorage.setItem(STORAGE_KEYS.dataRange, data.timeRange || 'default');
    }

    // 恢复用户收藏（仅非系统规则，内置规则由 seedSystemRules 重建）
    if (data.favorites) {
        try {
            const imported = JSON.parse(data.favorites);
            const userFavs = imported.filter(f => !f.system);
            // 确保每条用户收藏有 tags 字段（兼容旧导出）
            userFavs.forEach(f => { if (!f.tags) f.tags = ['用户']; });
            const currentSystem = (() => {
                try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || '[]').filter(f => f.system); }
                catch { return []; }
            })();
            localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...userFavs, ...currentSystem]));
        } catch { /* 静默处理无效数据 */ }
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

// condition 唯一 id 生成器（自增 + 时间戳，保证进程内唯一）
let _cidCounter = 0;
export function genCid() {
    _cidCounter++;
    return `c${Date.now().toString(36)}_${_cidCounter}`;
}

/**
 * 把任意历史格式的单条筛选记录归一化为 condition 数组
 * 兼容三种形态：
 *  - 新格式 {conditions:[{cid,operator,value}]}
 *  - 中间格式 {operator, values:[...]}
 *  - 旧格式 {value, operator}（字符串 value）
 * 仅用于输入框类型（调用方已判断非布尔/选项）
 * @param {object} data
 * @returns {Array<{cid:string, operator:string, value:string}>}
 */
function normalizeConditions(data) {
    if (!data) return [];
    if (Array.isArray(data.conditions)) {
        return data.conditions
            .filter(c => c && c.value != null && String(c.value).trim())
            .map(c => ({
                cid: c.cid || genCid(),
                operator: c.operator || '=',
                value: String(c.value).trim(),
            }));
    }
    if (Array.isArray(data.values)) {
        return data.values
            .filter(v => v != null && String(v).trim())
            .map(v => ({
                cid: genCid(),
                operator: data.operator || '=',
                value: String(v).trim(),
            }));
    }
    if (data.value != null && String(data.value).trim()) {
        return [{
            cid: genCid(),
            operator: data.operator || '=',
            value: String(data.value).trim(),
        }];
    }
    return [];
}

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
                operatorHtml = `<select class="filter-operator" data-key="${filter.key}" data-field="${filter.key}" ${disabled ? 'disabled' : ''}>`;
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
                            ${disabled ? 'disabled' : ''} onkeydown="if(event.key==='Enter'){event.preventDefault();submitFilterValue('${filter.key}')}" onblur="submitFilterValue('${filter.key}')">
                        <button type="button" class="filter-add-btn" onclick="submitFilterValue('${filter.key}')" ${disabled ? 'disabled' : ''}>+</button>
                    </div>
                    <div class="filter-chips" data-field="${filter.key}"></div>
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
                    operatorHtml = `<select class="filter-operator" data-key="${filter.key}" data-field="${filter.key}" ${disabled ? 'disabled' : ''}>`;
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
                                ${disabled ? 'disabled' : ''} onkeydown="if(event.key==='Enter'){event.preventDefault();submitFilterValue('${filter.key}')}" onblur="submitFilterValue('${filter.key}')">
                            <button type="button" class="filter-add-btn" onclick="submitFilterValue('${filter.key}')" ${disabled ? 'disabled' : ''}>+</button>
                        </div>
                        <div class="filter-chips" data-field="${filter.key}"></div>
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

// 操作符前缀符号（chip 显示用）
const OP_PREFIX = { '=': '', '!=': '≠', '*=': '~', '==': '≡' };
// 操作符颜色类（对应 CSS）
const OP_COLOR_CLASS = { '=': 'op-eq', '!=': 'op-ne', '*=': 'op-fuzzy', '==': 'op-exact' };

// 渲染某字段的值标签 chip 列表
export function renderFilterChips(field) {
    const container = document.querySelector(`.filter-chips[data-field="${field}"]`);
    if (!container) return;
    const record = activeFilters.get(field);
    const conditions = (record && Array.isArray(record.conditions)) ? record.conditions : [];
    if (conditions.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = conditions.map(c => {
        const prefix = OP_PREFIX[c.operator] != null ? OP_PREFIX[c.operator] : '';
        const colorClass = OP_COLOR_CLASS[c.operator] || 'op-eq';
        const label = prefix ? `${prefix}${escapeHtml(c.value)}` : escapeHtml(c.value);
        return `<span class="filter-chip ${colorClass}" data-cid="${escapeHtml(c.cid)}">${label}<span class="filter-chip-remove" data-field="${escapeHtml(field)}" data-cid="${escapeHtml(c.cid)}">&times;</span></span>`;
    }).join('');
}

// 事件委托：输入框旁 chip 的 × 按钮（.filter-chip-remove）点击 → 删除单个 condition。
// chips 由 renderFilterChips 用 innerHTML 重建，故挂到稳定祖先（document）一次，
// 用 _delegatedChips 标志防止重复绑定。与预览栏 .remove-filter 委托互不干扰（选择器不同）。
function setupChipRemoveDelegation() {
    if (document._delegatedChips) return;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-chip-remove');
        if (!btn) return;
        const field = btn.dataset.field;
        const cid = btn.dataset.cid;
        if (field && cid) {
            removeFilterCondition(field, cid);
        }
    });
    document._delegatedChips = true;
}
setupChipRemoveDelegation();

// 提交一个筛选值（输入框类型）
// 读当前操作符下拉 + 输入框值，push 进 conditions；逗号拆分；按 (operator,value) 去重
export function submitFilterValue(field) {
    const input = document.querySelector(`input[data-key="${field}"]`);
    const operatorSelect = document.querySelector(`.filter-operator[data-key="${field}"]`);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    const operator = operatorSelect ? operatorSelect.value : '=';

    // 含逗号拆分（贴合 FOFA 多值语义）
    const newValues = raw.split(',').map(v => v.trim()).filter(Boolean);
    if (newValues.length === 0) return;

    let record = activeFilters.get(field);
    if (!record) {
        record = { filter: field, conditions: [] };
        activeFilters.set(field, record);
    }
    if (!Array.isArray(record.conditions)) {
        record.conditions = normalizeConditions(record);
    }

    let dupCount = 0;
    newValues.forEach(val => {
        const escaped = val.replace(/"/g, '\\"');
        const exists = record.conditions.some(c => c.operator === operator && c.value === escaped);
        if (exists) {
            dupCount++;
        } else {
            record.conditions.push({ cid: genCid(), operator, value: escaped });
        }
    });

    if (dupCount > 0) {
        showToast(`已存在相同条件，跳过 ${dupCount} 项`, 'info');
    }

    input.value = '';
    renderFilterChips(field);
    updateActiveFiltersDisplay();
}

// 按 cid 删除单个 condition（输入框类型）
export function removeFilterCondition(field, cid) {
    const record = activeFilters.get(field);
    if (!record || !Array.isArray(record.conditions)) return;
    record.conditions = record.conditions.filter(c => c.cid !== cid);
    if (record.conditions.length === 0) {
        activeFilters.delete(field);
        const input = document.querySelector(`input[data-key="${field}"]`);
        if (input) input.value = '';
    }
    renderFilterChips(field);
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
    document.querySelectorAll('.filter-chips').forEach(c => {
        c.innerHTML = '';
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
        if (!data || typeof data !== 'object' || typeof data.filter !== 'string') return;
        // 验证 key 是否对应有效的 DOM 元素
        const tag = document.querySelector(`.filter-tag[data-key="${key}"]`);
        const input = document.querySelector(`input[data-key="${key}"]`);
        if (!tag && !input) return; // 跳过孤立的筛选条件

        const isInputType = !!input; // 输入框类型
        if (isInputType) {
            const conditions = normalizeConditions(data);
            if (conditions.length === 0) return;
            activeFilters.set(key, { filter: data.filter, conditions });
            // 不回填输入框（多值无法塞进单输入框），只渲染 chips
            renderFilterChips(data.filter);
            // 回填操作符下拉为最后一个 condition 的操作符（下次提交默认）
            const lastOp = conditions[conditions.length - 1].operator;
            const operatorSelect = document.querySelector(`.filter-operator[data-key="${key}"]`);
            if (operatorSelect) operatorSelect.value = lastOp;
        } else {
            // 布尔/选项类型
            activeFilters.set(key, { filter: data.filter, value: String(data.value) });
            if (tag) tag.classList.add('active');
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

// 检查是否有活跃的筛选条件
export function hasActiveFilters() {
    return activeFilters.size > 0;
}

// 更新已激活筛选显示（condition 级）
function updateActiveFiltersDisplay() {
    const container = document.getElementById('activeFilters');
    if (!container) return;

    if (activeFilters.size === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        if (_updateSearchButtonState) _updateSearchButtonState();
        return;
    }

    container.style.display = 'flex';
    const allFilters = getAllFilters();
    const previewParts = [];

    activeFilters.forEach((data, key) => {
        const config = allFilters.find(f => key === f.key || key === `${f.key}_true` || key === `${f.key}_false`)
            || allFilters.find(f => key.startsWith(f.key + '_'));
        if (!config) return;

        if (config.options) {
            const idx = config.options.indexOf(data.value);
            const lbl = `${config.label}: ${config.optionLabels[idx] != null ? config.optionLabels[idx] : data.value}`;
            previewParts.push(`<span class="active-filter-tag">${escapeHtml(lbl)}<span class="remove-filter" data-key="${escapeHtml(key)}">&times;</span></span>`);
        } else if (config.trueLabel) {
            const lbl = `${config.label}: ${data.value === 'true' ? config.trueLabel : config.falseLabel}`;
            previewParts.push(`<span class="active-filter-tag">${escapeHtml(lbl)}<span class="remove-filter" data-key="${escapeHtml(key)}">&times;</span></span>`);
        } else if (Array.isArray(data.conditions)) {
            // 输入框类型：每个 condition 一条
            data.conditions.forEach(c => {
                const opLabel = c.operator || '=';
                previewParts.push(`<span class="active-filter-tag">${escapeHtml(config.label)} ${escapeHtml(opLabel)} ${escapeHtml(c.value)}<span class="remove-filter" data-key="${escapeHtml(key)}" data-cid="${escapeHtml(c.cid || '')}">&times;</span></span>`);
            });
        } else {
            // 兼容旧格式残留
            const op = data.operator || '=';
            const lbl = `${config.label} ${op} ${data.value}`;
            previewParts.push(`<span class="active-filter-tag">${escapeHtml(lbl)}<span class="remove-filter" data-key="${escapeHtml(key)}">&times;</span></span>`);
        }
    });

    previewParts.push(`<span class="active-filter-tag active-filter-clear" data-action="clear-all">清除全部</span>`);
    container.innerHTML = previewParts.join('');

    // 事件委托：移除单个筛选（区分整字段 vs 单 condition）
    if (!container._delegated) {
        container.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.remove-filter');
            if (removeBtn) {
                const k = removeBtn.dataset.key;
                const cid = removeBtn.dataset.cid;
                if (cid) {
                    removeFilterCondition(findFieldByKey(k), cid);
                } else {
                    removeFilter(k);
                }
                return;
            }
            if (e.target.closest('[data-action="clear-all"]')) {
                clearAllFilters();
            }
        });
        container._delegated = true;
    }

    if (_updateSearchButtonState) _updateSearchButtonState();
}

// 由 activeFilters 的 key 反查字段名（输入框类型 key===field；布尔/选项 key 含后缀）
function findFieldByKey(key) {
    const record = activeFilters.get(key);
    if (record && record.filter) return record.filter;
    return key;
}

// 获取筛选查询字符串（多值合并）
export function getFilterQuery() {
    const parts = [];

    activeFilters.forEach((data, key) => {
        // 布尔类型
        if (data.value === 'true' || data.value === 'false') {
            parts.push(`${data.filter}=${data.value}`);
            return;
        }
        // 选项类型（key 含值后缀，filter !== key）
        if (data.filter !== key && !Array.isArray(data.conditions)) {
            parts.push(`${data.filter}="${data.value}"`);
            return;
        }
        // 输入框类型 —— 归一化为 condition 数组
        const conditions = normalizeConditions(data);
        if (conditions.length === 0) return;

        // 按 operator 分组
        const byOp = {};
        const opOrder = [];
        conditions.forEach(c => {
            if (!byOp[c.operator]) { byOp[c.operator] = []; opOrder.push(c.operator); }
            byOp[c.operator].push(c.value);
        });

        // 按首次出现顺序遍历操作符，保持输出稳定
        opOrder.forEach(op => {
            const vals = byOp[op];
            if (op === '=' || op === '*=') {
                // 逗号合并进同一引号（OR 语义）
                parts.push(`${data.filter}${op}"${vals.join(',')}"`);
            } else {
                // != / == 各自独立（AND 语义）
                vals.forEach(v => parts.push(`${data.filter}${op}"${v}"`));
            }
        });
    });

    return parts.join(' && ');
}
