// js/tauri-bridge.js - Tauri 桌面环境适配桥接层
// 检测是否运行在 Tauri 桌面环境中，并获取 Rust API 代理的端口

/**
 * 检测当前是否运行在 Tauri 桌面环境中
 * Tauri 会在 window 对象上注入 __TAURI_INTERNALS__
 */
export function isTauri() {
    return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * 通过 Tauri Command 获取 Rust API 代理的端口号
 * @returns {Promise<number>} 代理服务器监听的端口号
 */
async function getProxyPort() {
    return await window.__TAURI_INTERNALS__.invoke('get_proxy_port');
}

/**
 * 设置外部代理配置（传递给 Rust 侧 reqwest）
 * @param {string} host - 代理主机
 * @param {number} port - 代理端口
 * @param {string} username - 用户名（可选）
 * @param {string} password - 密码（可选）
 * @returns {Promise<string>} 设置结果消息
 */
export async function setProxyConfig(host, port, username, password) {
    if (!isTauri()) return '非 Tauri 环境，代理设置未生效';
    return await window.__TAURI_INTERNALS__.invoke('set_proxy_config_cmd', {
        host: host || '',
        port: port || 0,
        username: username || '',
        password: password || ''
    });
}

/**
 * 获取当前代理配置
 * @returns {Promise<Object|null>} 代理配置对象或 null
 */
export async function getProxyConfig() {
    if (!isTauri()) return null;
    return await window.__TAURI_INTERNALS__.invoke('get_proxy_config_cmd');
}

/**
 * 设置请求配置（User-Agent + 自定义 Headers）
 * @param {string} userAgent
 * @param {Object<string, string>} customHeaders
 * @returns {Promise<string>} 设置结果消息
 */
export async function setRequestConfig(userAgent, customHeaders) {
    if (!isTauri()) return '非 Tauri 环境，请求配置未生效';
    return await window.__TAURI_INTERNALS__.invoke('set_request_config_cmd', {
        userAgent: userAgent || '',
        customHeaders: customHeaders || {}
    });
}

/**
 * 获取当前请求配置
 * @returns {Promise<Object|null>}
 */
export async function getRequestConfig() {
    if (!isTauri()) return null;
    return await window.__TAURI_INTERNALS__.invoke('get_request_config_cmd');
}

/**
 * 初始化 Tauri 环境适配
 * 检测 Tauri 环境，获取 Rust 代理端口，返回 API 基础 URL
 * @returns {Promise<string>} API 基础 URL（Tauri 模式返回 'http://127.0.0.1:PORT'，Web 模式返回空字符串）
 */
export async function initTauriBridge() {
    if (!isTauri()) {
        return '';
    }

    const port = await getProxyPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // 验证代理健康状态
    const healthResp = await fetch(`${baseUrl}/health`);
    if (!healthResp.ok) {
        throw new Error('API 代理健康检查失败');
    }

    return baseUrl;
}

/**
 * 用系统默认浏览器打开 URL
 * Tauri 模式下调用 Rust 命令，Web 模式下回退到 window.open
 * @param {string} url
 */
export function openUrl(url) {
    if (isTauri()) {
        window.__TAURI_INTERNALS__.invoke('open_url', { url });
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

/**
 * 通过 Tauri Rust 侧检查 GitHub 更新（使用已配置的代理）
 * @returns {Promise<{version: string, url: string}|null>}
 */
export async function checkGitHubUpdate() {
    if (!isTauri()) return null;
    try {
        const data = await window.__TAURI_INTERNALS__.invoke('check_github_update_cmd');
        if (data && data.tag_name) {
            return {
                version: data.tag_name,
                url: data.html_url || 'https://github.com/Mr-xn/fofa_leak_search/releases'
            };
        }
        return null;
    } catch {
        return null;
    }
}
