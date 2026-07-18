// js/stats.js - 统计聚合功能

import { state } from './config.js';
import { fetchStats } from './api.js';
import { formatNumber, escapeHtml, showToast } from './utils.js';
import { downloadNodeScreenshot } from './screenshot.js';
import { error as logError } from './logger.js';

// 统计聚合支持的字段
export const STATS_FIELDS = ['protocol', 'port', 'country', 'domain', 'os', 'server', 'org', 'asn', 'asset_type', 'title', 'fid', 'icp'];

// 统计缓存: Map<queryKey, { data, timestamp }>
const statsCache = new Map();
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// ==================== 统计可用性判断 ====================
/**
 * 判断统计功能是否可用（有查询且有 API Key）
 * @param {string} currentQuery - 当前查询
 * @param {string} apiKey - API Key
 * @returns {boolean}
 */
export function isStatsAvailable(currentQuery, apiKey) {
    return !!(currentQuery && typeof currentQuery === 'string' && currentQuery.trim().length > 0
              && apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0);
}

/**
 * 根据当前状态更新统计按钮的禁用状态
 * @param {string} [currentQuery] - 当前查询（可选，默认从 state 读取）
 * @param {string} [apiKey] - API Key（可选，默认从 state 读取）
 */
export function updateStatsButtonState(currentQuery, apiKey) {
    const btn = document.getElementById('statsToggleBtn');
    if (!btn) return;

    const query = currentQuery !== undefined ? currentQuery : state.currentQuery;
    const key = apiKey !== undefined ? apiKey : state.apiKey;
    const available = isStatsAvailable(query, key);

    btn.disabled = !available;
    btn.classList.toggle('disabled', !available);
}

// ==================== 加载并渲染统计 ====================
export async function loadStats() {
    if (!state.currentQuery || !state.apiKey) return;

    const statsContent = document.getElementById('statsContent');
    if (!statsContent) return;

    // 检查缓存
    const queryKey = state.currentQuery;
    const cached = statsCache.get(queryKey);
    if (cached && (Date.now() - cached.timestamp) < STATS_CACHE_TTL) {
        renderStats(cached.data);
        return;
    }

    // 显示加载状态
    statsContent.innerHTML = '<div class="stats-loading">正在加载统计信息...</div>';
    showStatsPanel();

    try {
        const data = await fetchStats(state.currentQuery, STATS_FIELDS.join(','));

        if (data.error) {
            statsContent.innerHTML = `<div class="stats-error">加载失败: ${escapeHtml(data.errmsg)}</div>`;
            return;
        }

        // 写入缓存
        statsCache.set(queryKey, { data, timestamp: Date.now() });

        // 清理过期缓存
        if (statsCache.size > 20) {
            const now = Date.now();
            for (const [key, entry] of statsCache) {
                if (now - entry.timestamp > STATS_CACHE_TTL) {
                    statsCache.delete(key);
                }
            }
        }

        renderStats(data);
    } catch (error) {
        statsContent.innerHTML = `<div class="stats-error">加载失败: ${escapeHtml(error.message)}</div>`;
    }
}

// ==================== 渲染统计结果 ====================
export function renderStats(data) {
    const statsContent = document.getElementById('statsContent');
    if (!statsContent) return;

    if (!data.aggs) {
        statsContent.innerHTML = '<div class="stats-loading">无统计数据</div>';
        return;
    }

    const entries = Object.entries(data.aggs);
    if (entries.length === 0) {
        statsContent.innerHTML = '<div class="stats-loading">无统计数据</div>';
        return;
    }

    let html = '';

    // 基本信息
    html += `<div class="stats-summary">共 ${formatNumber(data.size)} 条资产`;

    if (data.distinct) {
        const distinctParts = [];
        if (data.distinct.ip) distinctParts.push(`${data.distinct.ip} 个独立IP`);
        if (data.distinct.title) distinctParts.push(`${data.distinct.title} 个独立标题`);
        if (data.distinct.domain) distinctParts.push(`${data.distinct.domain} 个独立域名`);
        if (data.distinct.server) distinctParts.push(`${data.distinct.server} 个独立Server`);
        if (data.distinct.icp) distinctParts.push(`${data.distinct.icp} 个独立ICP`);
        if (data.distinct.fid) distinctParts.push(`${data.distinct.fid} 个独立FID`);
        if (distinctParts.length > 0) {
            html += ' · ' + distinctParts.join(' · ');
        }
    }

    if (data.lastupdatetime) {
        html += ` · 数据更新: ${data.lastupdatetime}`;
    }
    html += '</div>';

    // 渲染各字段统计卡片
    html += '<div class="stats-grid">';
    for (const [field, items] of entries) {
        if (!items || items.length === 0) continue;
        html += renderStatsCard(field, items, data.size);
    }
    html += '</div>';

    statsContent.innerHTML = html;
}

// ==================== 渲染单个统计卡片 ====================
export function renderStatsCard(field, items, totalSize) {
    const maxCount = items[0]?.count || 1;

    const rows = items.map(item => {
        const barWidth = maxCount > 0 ? Math.max(2, (item.count / maxCount) * 100) : 0;
        const percent = totalSize > 0 ? ((item.count / totalSize) * 100).toFixed(1) : '0';
        const name = item.name || '(空)';
        return `
            <div class="stats-item-row" title="${escapeHtml(name)}: ${formatNumber(item.count)} 条 (${percent}%)">
                <div class="stats-item-bar-wrapper">
                    <div class="stats-item-name">${escapeHtml(name)}</div>
                    <div class="stats-item-bar-bg">
                        <div class="stats-item-bar" style="width: ${barWidth}%"></div>
                    </div>
                </div>
                <div class="stats-item-count">${formatNumber(item.count)}</div>
                <div class="stats-item-percent">${percent}%</div>
            </div>
        `;
    }).join('');

    return `
        <div class="stats-card">
            <div class="stats-card-title">${FIELD_NAMES[field] || field}</div>
            <div class="stats-card-body">${rows}</div>
        </div>
    `;
}

// ==================== 字段中文名映射 ====================
export const FIELD_NAMES = {
    protocol: '协议',
    domain: '域名',
    port: '端口',
    title: '网站标题',
    os: '操作系统',
    server: 'HTTP Server',
    country: '国家/地区',
    asn: 'ASN 编号',
    org: 'ASN 组织',
    asset_type: '资产类型',
    fid: 'FID',
    icp: 'ICP 备案'
};

// ==================== 显示/隐藏统计面板 ====================
export function showStatsPanel() {
    const panel = document.getElementById('statsPanel');
    const btn = document.getElementById('statsToggleBtn');
    if (panel) panel.style.display = 'block';
    if (btn) btn.classList.add('btn-primary');
}

export function hideStatsPanel() {
    const panel = document.getElementById('statsPanel');
    const btn = document.getElementById('statsToggleBtn');
    if (panel) panel.style.display = 'none';
    if (btn) btn.classList.remove('btn-primary');
}

export function toggleStats() {
    const panel = document.getElementById('statsPanel');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        showStatsPanel();
        // 如果有当前查询但没有缓存数据，加载统计
        if (state.currentQuery && state.apiKey) {
            loadStats();
        }
    } else {
        hideStatsPanel();
    }
}

// ==================== 刷新统计 ====================
export function refreshStats() {
    if (!state.currentQuery || !state.apiKey) {
        showToast('请先执行搜索', 'error');
        return;
    }
    // 清除缓存，强制重新加载
    statsCache.delete(state.currentQuery);
    loadStats();
}

// ==================== 统计截图 ====================
/**
 * 下载 #statsContent 节点为 PNG 截图
 * 判断节点存在且有实际数据（非加载中态），再调通用截图。
 */
export async function downloadStatsScreenshot() {
    const node = document.getElementById('statsContent');
    if (!node) {
        showToast('暂无统计数据', 'info');
        return;
    }
    // 加载中态判断：节点内只剩/包含 .stats-loading 占位
    if (node.querySelector('.stats-loading')) {
        showToast('暂无统计数据', 'info');
        return;
    }
    try {
        await downloadNodeScreenshot(node, 'fofa_stats');
        showToast('已下载统计截图', 'success');
    } catch (e) {
        logError('stats', '截图下载失败', { message: e.message || String(e) });
        showToast(`截图失败: ${e.message || e}`, 'error');
    }
}
