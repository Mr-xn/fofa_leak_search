// js/utils.js - 工具函数

import { STORAGE_KEYS } from './config.js';

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
