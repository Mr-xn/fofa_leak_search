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
