// js/utils.js - 工具函数

import { STORAGE_KEYS } from './config.js';
import { isTauri, saveExportFile } from './tauri-bridge.js';

// ==================== Toast 提示 ====================
export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== 确认弹窗 ====================
/**
 * 显示自定义确认弹窗（替代 window.confirm，跨平台一致）
 * @param {string|{message: string, title?: string, confirmText?: string, cancelText?: string, defaultFocus?: 'ok'|'cancel'}} messageOrOpts
 * @returns {Promise<boolean>} 用户点击"继续/允许"返回 true，"取消"或关闭返回 false
 */
export function showConfirm(messageOrOpts) {
    const opts = typeof messageOrOpts === 'string'
        ? { message: messageOrOpts }
        : messageOrOpts;

    return new Promise((resolve) => {
        const titleEl = document.getElementById('confirmTitle');
        const msgEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        const modal = document.getElementById('confirmModal');

        // 标题（可选）
        if (opts.title) {
            titleEl.textContent = opts.title;
            titleEl.style.display = '';
        } else {
            titleEl.textContent = '';
            titleEl.style.display = 'none';
        }

        // 消息（支持 HTML，因为调用方可能传 <strong>）
        msgEl.innerHTML = opts.message || '';

        // 按钮文案
        okBtn.textContent = opts.confirmText || '继续';
        cancelBtn.textContent = opts.cancelText || '取消';

        modal.classList.add('show');

        // 默认聚焦（F 点授权默认聚焦取消按钮，防误点）
        const focusTarget = opts.defaultFocus === 'cancel' ? cancelBtn
            : opts.defaultFocus === 'ok' ? okBtn
            : null;
        if (focusTarget) {
            // setTimeout 确保 modal 显示后再 focus
            setTimeout(() => focusTarget.focus(), 0);
        }

        const cleanup = (result) => {
            modal.classList.remove('show');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        modal.onclick = (e) => {
            if (e.target === modal) cleanup(false);
        };
    });
}

// ==================== 数字格式化 ====================
export function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
}

// ==================== 时间格式化 ====================
export function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return date.toLocaleDateString('zh-CN');
}

// ==================== HTML 转义 ====================
export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 防抖函数 ====================
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ==================== 缓存时间格式化 ====================
export function formatCacheExpiry() {
    const value = parseInt(localStorage.getItem(STORAGE_KEYS.cacheTimeValue) || '1');
    const unit = localStorage.getItem(STORAGE_KEYS.cacheTimeUnit) || 'days';
    const unitNames = {
        'hours': '小时',
        'days': '天',
        'months': '个月'
    };
    return `${value} ${unitNames[unit] || '天'}`;
}

// ==================== 获取缓存过期时间（毫秒）====================
export function getCacheExpiry() {
    const value = parseInt(localStorage.getItem(STORAGE_KEYS.cacheTimeValue) || '1');
    const unit = localStorage.getItem(STORAGE_KEYS.cacheTimeUnit) || 'days';

    switch (unit) {
        case 'hours': return value * 60 * 60 * 1000;
        case 'days': return value * 24 * 60 * 60 * 1000;
        case 'months': return value * 30 * 24 * 60 * 60 * 1000;
        default: return 365 * 24 * 60 * 60 * 1000;
    }
}

// ==================== Blob 文件下载 ====================

/** blob URL 延迟释放时间（毫秒） */
const BLOB_REVOKE_DELAY_MS = 3000;

/**
 * 触发文件下载（Blob → <a download> 点击）
 *
 * 关键：URL.revokeObjectURL 必须延迟释放。macOS WKWebView 的下载是异步读取
 * blob URL，click() 后立即 revoke 会让大文件（MB 级 CSV）下载被静默截断
 * （小文件常在释放前读完，所以症状只在大导出上出现）。
 *
 * @param {string} filename - 保存文件名
 * @param {Blob} blob - 文件内容
 * @returns {string} 创建的 object URL（供诊断）
 */
export function triggerBlobDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS);
    return url;
}

/**
 * 保存文本文件（导出统一入口）
 *
 * - 桌面端（Tauri）：Rust 原生写盘到系统下载目录，绕开 WebView 下载栈
 *   （macOS WKWebView / Linux WebKitGTK 的大文件 blob 下载会静默失败）
 * - web 模式：降级为 blob 下载（浏览器下载栈可靠）
 *
 * @param {string} filename - 文件名
 * @param {string} text - 文本内容
 * @param {string} [mimeType] - web 降级模式的 MIME 类型
 * @returns {Promise<{path: string|null, dirFallback?: boolean, fallbackReason?: string}>}
 *          桌面端成功返回保存路径；dirFallback=设置目录不可用已回退下载目录；
 *          降级/网页模式 path 为 null，blob 降级时带原因
 */
export async function saveTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
    if (isTauri()) {
        // 保存位置取设置面板配置；留空 = 系统「下载」目录（由 Rust 侧回退）
        const targetDir = (localStorage.getItem(STORAGE_KEYS.exportSaveDir) || '').trim() || null;
        try {
            const r = await saveExportFile(filename, text, targetDir);
            return { path: r.path, dirFallback: !!r.dir_fallback };
        } catch (e) {
            // 原生保存失败兜底：退回 WebView 下载，至少让文件产出；原因带回给调用方提示
            const reason = e?.message || String(e);
            triggerBlobDownload(filename, new Blob([text], { type: mimeType }));
            return { path: null, fallbackReason: reason };
        }
    }
    triggerBlobDownload(filename, new Blob([text], { type: mimeType }));
    return { path: null };
}

/**
 * 拼装导出 CSV 文本（智能下载 / 结果页导出共用）
 *
 * 格式与既有导出一致：BOM +（可选）查询元信息行 + 表头 + 数据行，单元格全部加引号。
 *
 * @param {Array<Array>} rows - 数据行
 * @param {Array<string>} fields - 字段名（表头顺序）
 * @param {Object} [opts]
 * @param {boolean} [opts.includeQuery] - 首行插入查询元信息行
 * @param {string} [opts.query] - 查询语句（includeQuery 时用）
 * @param {string} [opts.exportTime] - 导出时间（默认当前时间，测试可注入）
 * @param {Object} [opts.fieldLabels] - 表头显示名映射（结果页中文列名）
 * @returns {string} CSV 文本（含 BOM）
 */
export function buildCsvText(rows, fields, opts = {}) {
    const BOM = '﻿';
    const header = fields
        .map(f => `"${(opts.fieldLabels && opts.fieldLabels[f]) || f}"`)
        .join(',');
    let metaRow = '';
    if (opts.includeQuery) {
        const queryStr = opts.query || '(无)';
        const exportTime = opts.exportTime || new Date().toLocaleString('zh-CN', { hour12: false });
        const escapedQuery = String(queryStr).replace(/"/g, '""');
        metaRow = `"查询: ${escapedQuery}    导出时间: ${exportTime}    条数: ${rows.length}",`
            + fields.slice(1).map(() => '').join(',') + '\n';
    }
    const body = rows.map(row =>
        row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    return BOM + metaRow + header + '\n' + body;
}
