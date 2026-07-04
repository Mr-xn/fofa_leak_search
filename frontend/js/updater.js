// js/updater.js - 在线更新检测

import { APP_VERSION, STORAGE_KEYS, state } from './config.js';
import { showToast } from './utils.js';
import { checkGitHubUpdate } from './tauri-bridge.js';
import { info as logInfo, warn as logWarn, error as logError } from './logger.js';

const GITHUB_REPO = 'Mr-xn/fofa_leak_search';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

// ==================== 版本解析 ====================

/**
 * 解析版本号字符串为数字数组
 * @param {string} version - 如 "v1.2.3" 或 "1.2.3"
 * @returns {number[]} - 如 [1, 2, 3]，非法输入返回 []
 */
export function parseVersion(version) {
    if (!version || typeof version !== 'string') return [];
    // 去掉 v/V 前缀，按 . 分割，过滤非数字段
    const parts = version.replace(/^[vV]/, '').split('.');
    return parts
        .map(p => parseInt(p, 10))
        .filter(n => !isNaN(n));
}

/**
 * 比较两个版本号
 * @param {string} a - 版本号 A
 * @param {string} b - 版本号 B
 * @returns {number} - a > b 返回 1，a = b 返回 0，a < b 返回 -1
 */
export function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

/**
 * 判断 latest 是否比 current 更新
 * @param {string} latest - 最新版本号
 * @param {string} current - 当前版本号
 * @returns {boolean}
 */
export function isNewerVersion(latest, current) {
    if (!latest || !current) return false;
    return compareVersions(latest, current) > 0;
}

// ==================== GitHub API ====================

/**
 * 获取 GitHub 最新 release 信息
 * @returns {Promise<{version: string, url: string}|null>}
 */
export async function fetchLatestRelease() {
    logInfo('updater', '开始获取 GitHub 最新版本', { url: RELEASES_API });
    // 优先使用 Tauri Rust 侧请求（走代理），回退到前端 fetch
    const tauriResult = await checkGitHubUpdate();
    if (tauriResult) {
        logInfo('updater', '通过 Tauri 获取最新版本成功', { version: tauriResult.version, url: tauriResult.url });
        return tauriResult;
    }

    try {
        const response = await fetch(RELEASES_API, {
            headers: { Accept: 'application/vnd.github+json' }
        });
        logInfo('updater', 'GitHub Releases API 响应', { status: response.status, ok: response.ok, url: RELEASES_API });
        if (!response.ok) return null;

        const data = await response.json();
        if (!data || !data.tag_name) return null;

        return {
            version: data.tag_name,
            url: data.html_url || RELEASES_URL
        };
    } catch (e) {
        logError('updater', '获取 GitHub 最新版本失败', { message: e.message || String(e), url: RELEASES_API });
        return null;
    }
}

// ==================== 更新检查 ====================

/**
 * 检查是否有新版本
 * @param {boolean} [silent=false] - true 时不显示 toast
 * @returns {Promise<{hasUpdate: boolean, latestVersion?: string, currentVersion: string, releaseUrl?: string}>}
 */
export async function checkForUpdates(silent = false) {
    const currentVersion = APP_VERSION;

    const release = await fetchLatestRelease();
    if (!release) {
        logWarn('updater', '检查更新失败：未获取到 release', { silent, currentVersion });
        if (!silent) {
            showToast('检查更新失败，请检查网络连接', 'error');
        }
        return { hasUpdate: false, currentVersion };
    }

    const hasUpdate = isNewerVersion(release.version, currentVersion);
    logInfo('updater', '更新检查完成', {
        silent,
        currentVersion,
        latestVersion: release.version,
        hasUpdate,
        releaseUrl: release.url
    });

    if (hasUpdate) {
        showUpdateBanner(release.version, release.url);
        return {
            hasUpdate: true,
            latestVersion: release.version,
            currentVersion,
            releaseUrl: release.url
        };
    }

    if (!silent) {
        showToast('已是最新版本', 'success');
    }
    return { hasUpdate: false, currentVersion };
}

/**
 * 手动检查更新（从设置面板触发）
 */
export async function manualCheckUpdate() {
    showToast('正在检查更新...', 'info');
    return await checkForUpdates(false);
}

/**
 * 启动时自动检查更新（静默模式：无更新时不提示，有更新时显示横幅）
 */
export async function autoCheckUpdate() {
    if (!state.autoCheckUpdate) return;
    return await checkForUpdates(true);
}

// ==================== 更新提示横幅 ====================

/**
 * 显示新版本横幅
 * @param {string} version - 最新版本号
 * @param {string} url - 下载地址
 */
function showUpdateBanner(version, url) {
    // 移除旧横幅
    const existing = document.getElementById('updateBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML = `
        <span class="update-banner-text">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            发现新版本 <strong>${version}</strong>，建议更新以获得最新功能和安全修复
        </span>
        <div class="update-banner-actions">
            <a class="update-banner-link" onclick="event.preventDefault();window.openUrl('${url}')" href="${url}">
                前往下载 →
            </a>
            <button class="update-banner-close" onclick="this.parentElement.parentElement.remove()" title="关闭">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
    `;

    // 插入到 search-area 前面
    const searchArea = document.querySelector('.search-area');
    if (searchArea) {
        searchArea.parentNode.insertBefore(banner, searchArea);
    }
}
