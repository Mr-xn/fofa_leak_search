// js/results.js - 结果展示（表格、排序、分页、下载）

import { state, FIELD_LABELS, STORAGE_KEYS } from './config.js';
import { escapeHtml, formatNumber, showToast, showConfirm } from './utils.js';
import { getSelectedFields } from './ui.js';
import { fetchSearchResults } from './api.js';
import { incrementDownloads, incrementApiCalls, incrementDataCount } from './storage.js';
import { info as logInfo, warn as logWarn, error as logError, debug as logDebug } from './logger.js';
import { openUrl } from './tauri-bridge.js';

// 延迟注入：打破 search.js ↔ results.js 循环依赖
let _fetchResults = null;
export function setFetchResults(fn) {
    _fetchResults = fn;
}

// ==================== 列宽拖动功能 ====================
let resizing = null;
let startX = 0;
let startWidth = 0;
// 用户拖动后的列宽缓存：field → px。renderTable 时复用，跨排序/分页/重搜保留。
const columnWidths = new Map();

function initColumnResize() {
    // 列宽拖动由 inline onmousedown 触发，mousemove/mouseup 仅在拖动期间绑定。
}

function startResize(e, th) {
    e.preventDefault();
    e.stopPropagation();

    resizing = th;
    startX = e.clientX;
    startWidth = th.offsetWidth;

    th.querySelector('.resize-handle')?.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
}

function handleResize(e) {
    if (!resizing) return;

    const diff = e.clientX - startX;
    // table-layout: fixed 下，仅 th 的 width 决定整列宽度；
    // 拖多少即显示多宽，超出部分由 td 的 overflow+ellipsis 隐藏。
    const newWidth = Math.max(80, startWidth + diff);
    resizing.style.width = `${newWidth}px`;
    // 持久化到 Map：sortTable/renderTable 重新生成 thead 时仍能恢复用户拖动后的宽度。
    // 与 getColumnWidth 一致存带 px 的字符串，避免模板拼接出无单位的非法 CSS。
    const field = resizing.dataset.field;
    if (field) columnWidths.set(field, `${newWidth}px`);
}

function stopResize() {
    if (resizing) {
        resizing.querySelector('.resize-handle')?.classList.remove('active');
        resizing = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    // mousedown→mouseup 会被浏览器合成 click 事件，冒泡到 th 触发排序，
    // 必须在捕获阶段吞掉这一次 click，否则拖动会触发排序并重置列宽。
    document.addEventListener('click', suppressClickAfterDrag, { capture: true, once: true });
}

function suppressClickAfterDrag(e) {
    e.stopPropagation();
    e.preventDefault();
}

// 测试辅助：清空列宽缓存（vitest 同文件 it 块共享模块状态）
export function _resetColumnWidthsForTest() {
    columnWidths.clear();
}

// ==================== IPv6 地址检测 ====================
function isIPv6(value) {
    if (!value || typeof value !== 'string') return false;
    // IPv6 地址包含至少 2 个冒号（排除 URL 的 http://），且不含 URL 路径斜杠
    const colons = (value.match(/:/g) || []).length;
    return colons >= 2 && !value.includes('/') && !value.includes('.');
}

function formatIPv6(value) {
    if (!value || !isIPv6(value)) return value;
    // 截断显示：前20个字符 + ... + 后10个字符
    if (value.length > 30) {
        return value.substring(0, 20) + '...' + value.substring(value.length - 10);
    }
    return value;
}

// ==================== 表格渲染 ====================

/**
 * FOFA 的 link 字段有时会返回展示用的中间省略值（如 http://foo-...bar.com）。
 * 同一行 host 字段若是完整主机名，则用协议 + host 恢复可点击链接。
 * @param {string} linkValue
 * @param {Array} row
 * @param {Array<string>} fields
 * @returns {string}
 */
export function recoverEllipsizedLink(linkValue, row, fields) {
    if (!linkValue || typeof linkValue !== 'string' || !linkValue.includes('...')) return linkValue;
    const hostIndex = fields.indexOf('host');
    if (hostIndex === -1 || !row || !row[hostIndex]) return linkValue;
    const host = String(row[hostIndex]).trim();
    if (!host || host.includes('...')) return linkValue;
    const protocol = linkValue.match(/^https:\/\//i) ? 'https://' : 'http://';
    const recovered = `${protocol}${host}`;
    logDebug('results', 'URL 省略号修复', { from: linkValue, to: recovered, host });
    return recovered;
}

// 根据字段类型估算合适的列宽
function getColumnWidth(field, totalFields) {
    // 当字段较少时给更宽的默认值，字段多时用紧凑宽度
    const isCompact = totalFields > 6;
    const widths = {
        'ip': isCompact ? '130px' : '160px',
        'domain': isCompact ? '140px' : '180px',
        'host': isCompact ? '140px' : '180px',
        'port': '70px',
        'protocol': '80px',
        'title': isCompact ? '160px' : '220px',
        'link': isCompact ? '180px' : '240px',
        'server': isCompact ? '120px' : '160px',
        'country': isCompact ? '80px' : '100px',
        'country_name': isCompact ? '90px' : '110px',
        'city': isCompact ? '80px' : '100px',
        'asn': '80px',
        'org': isCompact ? '120px' : '160px',
        'cert': isCompact ? '140px' : '180px',
        'icp': isCompact ? '120px' : '150px',
        'header': isCompact ? '140px' : '200px',
        'body': isCompact ? '120px' : '160px',
        'banner': isCompact ? '120px' : '160px',
        'os': '80px',
        'lastupdatetime': '110px',
        'fid': '80px',
    };
    return widths[field] || (isCompact ? '100px' : '130px');
}

export function renderTable(fields) {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');

    // colgroup：fixed-layout 下 <col> 是被浏览器最严格尊重的列宽来源（规范高于 th 内联 width）。
    // 关键动机：WebKitGTK (Linux) 在 table-layout:fixed 下仍把 td 的 nowrap 内容算进列最小宽度，
    // 导致 macOS 能拖窄、Ubuntu 拖不动；显式生成与 th 同源的 <col> 把"列宽地板"钉死，
    // 让两个引擎都只认 col 指定的宽度，从而实现跨平台可拖窄。宽度值与下方 th 完全同源。
    const colWidths = fields.map(field => columnWidths.get(field) || getColumnWidth(field, fields.length));
    const table = document.querySelector('table');
    let colgroup = table && table.querySelector(':scope > colgroup');
    if (table && !colgroup) {
        // index.html 的 <table> 默认无 colgroup；自动创建并插入为 table 第一个子节点（必须在 thead 之前）。
        colgroup = document.createElement('colgroup');
        table.insertBefore(colgroup, table.firstChild);
    }
    if (colgroup) {
        colgroup.innerHTML = `
            <col style="width: 50px;">${colWidths.map(w => `<col style="width: ${w};">`).join('')}
        `;
    }

    thead.innerHTML = `
        <tr>
            <th style="width: 50px; min-width: 50px; max-width: 50px;">
                <span class="th-inner">#</span>
            </th>
            ${fields.map((field, index) => {
                // 与上方 colgroup 同源；优先用用户拖动后的宽度，否则用字段默认宽度。
                // 不设内联 min-width（CSS th { min-width: 80px } 已是 floor），否则拖窄会被阻止。
                const colWidth = colWidths[index];
                // 尾列右边缘 = 表格右边框，不渲染拖拽手柄（与首列 # 一样无意义且视觉突兀）
                const isLast = index === fields.length - 1;
                const handle = isLast ? '' : `
                    <div class="resize-handle" onmousedown="event.stopPropagation(); window.startColumnResize(event, this.parentElement)"></div>`;
                return `
                <th onclick="window.sortTable(${index})" data-field="${field}" style="cursor: pointer; width: ${colWidth};">
                    <span class="th-inner">
                        <span class="th-label">${FIELD_LABELS[field] || field} <span class="sort-icon" id="sort-${index}">↕</span></span>
                        <span class="copy-col-btn" onclick="event.stopPropagation(); window.copyColumn(${index})" title="复制此列">📋</span>
                    </span>${handle}
                </th>
                `;
            }).join('')}
        </tr>
    `;

    const startIdx = (state.currentPage - 1) * parseInt(document.getElementById('pageSize').value);
    tbody.innerHTML = state.results.map((row, rowIndex) => `
        <tr>
            <td style="color: var(--text-secondary); font-size: 12px; width: 50px; min-width: 50px; max-width: 50px;">${startIdx + rowIndex + 1}</td>
            ${row.map((cell, cellIndex) => {
                const field = fields[cellIndex];
                const isIpv6 = isIPv6(cell);
                const cellClasses = [];
                if (field === 'ip') cellClasses.push(isIpv6 ? 'ipv6-cell' : 'ip-cell');
                if (field === 'link') cellClasses.push('link-cell');
                const cellClass = cellClasses.join(' ');
                const recoveredCell = field === 'link' ? recoverEllipsizedLink(cell, row, fields) : cell;
                const displayValue = (field === 'ip' && isIpv6) ? formatIPv6(recoveredCell) : recoveredCell;
                return `
                    <td title="${escapeHtml(recoveredCell)}" class="${cellClass}">
                        ${formatCell(displayValue, field)}
                    </td>
                `;
            }).join('')}
        </tr>
    `).join('');

    // 初始化列宽拖动
    initColumnResize();
}

function formatCell(value, field) {
    if (!value) return '-';

    // link 字段：渲染为可点击链接，用系统默认浏览器打开
    if (field === 'link' && /^https?:\/\//i.test(value)) {
        // 完整 URL 作为显示文本，CSS text-overflow: ellipsis 处理视觉截断
        // data-fullurl 存储原始 URL，onclick 通过 getAttribute 读取确保不被 HTML 实体破坏
        const displayText = escapeHtml(value);
        const hrefSafe = value.replace(/"/g, '%22');
        const titleSafe = escapeHtml(value);
        const encodedUrl = encodeURIComponent(value);
        return `<a class="cell-link" href="${hrefSafe}" 
                   onclick="event.preventDefault();event.stopPropagation();window.openUrl(decodeURIComponent(this.dataset.fullurl))"
                   data-fullurl="${encodedUrl}"
                   title="${titleSafe}">${displayText}</a>`;
    }

    return escapeHtml(value);
}

// 导出列宽拖动函数供 HTML 使用
window.startColumnResize = startResize;

// 复制指定列的所有数据到剪贴板
export function copyColumn(columnIndex) {
    if (!state.results || state.results.length === 0) {
        showToast('没有可复制的数据', 'error');
        return;
    }

    const columnData = state.results
        .map(row => row[columnIndex] || '')
        .filter(v => v !== '')
        .join('\n');

    if (!columnData) {
        showToast('该列无数据', 'error');
        return;
    }

    navigator.clipboard.writeText(columnData).then(() => {
        showToast(`已复制 ${state.results.length} 条数据`, 'success');
    }).catch(() => {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = columnData;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`已复制 ${state.results.length} 条数据`, 'success');
    });
}

// ==================== 排序功能 ====================
export function sortTable(columnIndex) {
    if (columnIndex === -1) return;

    if (state.sortField === columnIndex) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortField = columnIndex;
        state.sortOrder = 'asc';
    }

    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.textContent = '↕';
        icon.classList.remove('active');
    });

    const sortIcon = document.getElementById(`sort-${columnIndex}`);
    sortIcon.textContent = state.sortOrder === 'asc' ? '↑' : '↓';
    sortIcon.classList.add('active');

    state.results.sort((a, b) => {
        const valueA = a[columnIndex] || '';
        const valueB = b[columnIndex] || '';

        const numA = parseFloat(valueA);
        const numB = parseFloat(valueB);

        if (!isNaN(numA) && !isNaN(numB)) {
            return state.sortOrder === 'asc' ? numA - numB : numB - numA;
        }

        const strA = valueA.toString().toLowerCase();
        const strB = valueB.toString().toLowerCase();

        if (state.sortOrder === 'asc') {
            return strA.localeCompare(strB);
        } else {
            return strB.localeCompare(strA);
        }
    });

    const fields = getSelectedFields().split(',');
    renderTable(fields);
}

// ==================== 分页功能 ====================
export function renderPagination(pageSize) {
    const totalPages = Math.ceil(state.totalResults / pageSize);
    const pagination = document.getElementById('pagination');

    if (totalPages <= 1) {
        pagination.classList.remove('show');
        pagination.innerHTML = '';
        return;
    }

    let pages = [];
    const maxVisible = 7;
    let start = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
    }

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages);
    }

    pagination.innerHTML = `
        <button class="page-btn" onclick="window.goToPage(${state.currentPage - 1})" ${state.currentPage === 1 ? 'disabled' : ''}>
            ← 上一页
        </button>
        ${pages.map(page => {
            if (page === '...') {
                return '<span class="page-info">...</span>';
            }
            return `
                <button class="page-btn ${page === state.currentPage ? 'active' : ''}" onclick="window.goToPage(${page})">
                    ${page}
                </button>
            `;
        }).join('')}
        <button class="page-btn" onclick="window.goToPage(${state.currentPage + 1})" ${state.currentPage === totalPages ? 'disabled' : ''}>
            下一页 →
        </button>
        <span class="page-info">共 ${formatNumber(state.totalResults)} 条结果</span>
    `;
    pagination.classList.add('show');
}

export function goToPage(page) {
    if (page < 1 || state.isLoading) return;
    state.currentPage = page;
    if (_fetchResults) _fetchResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== 下载进度展示 ====================
let downloadProgressTimer = null;

// 显示下载进度区域
export function showDownloadProgress() {
    const progressEl = document.getElementById('downloadProgress');
    if (progressEl) {
        progressEl.style.display = 'block';
    }
}

// 隐藏下载进度区域
export function hideDownloadProgress() {
    const progressEl = document.getElementById('downloadProgress');
    if (progressEl) {
        progressEl.style.display = 'none';
    }
    if (downloadProgressTimer) {
        clearInterval(downloadProgressTimer);
        downloadProgressTimer = null;
    }
}

// 更新下载进度
export function updateDownloadProgress(status, current, total, details = '') {
    const statusEl = document.getElementById('downloadStatus');
    const barEl = document.getElementById('downloadProgressBar');
    const infoEl = document.getElementById('downloadInfo');

    if (statusEl) statusEl.textContent = status;
    if (barEl && total > 0) {
        const percent = Math.round((current / total) * 100);
        barEl.style.width = `${percent}%`;
    }
    if (infoEl) infoEl.textContent = details || `${current} / ${total} 页`;
}

// 保存下载页码范围设置
function saveDownloadRange(startPage, endPage) {
    const range = { startPage, endPage, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEYS.downloadRange, JSON.stringify(range));
}

// 恢复下载页码范围设置
function restoreDownloadRange() {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS.downloadRange);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        // 静默处理
    }
    return null;
}

// ==================== 下载功能 ====================

// 批量打开当前页所有链接
export async function openAllLinks() {
    if (!state.results || state.results.length === 0) {
        showToast('没有可打开的链接', 'error');
        return;
    }

    const fields = getSelectedFields().split(',');
    const linkIndex = fields.indexOf('link');

    if (linkIndex === -1) {
        showToast('当前未选择「链接」字段', 'error');
        return;
    }

    const urls = state.results
        .map(row => row[linkIndex])
        .filter(url => url && typeof url === 'string' && /^https?:\/\//i.test(url.trim()));

    if (urls.length === 0) {
        showToast('当前页无有效链接', 'info');
        return;
    }

    if (urls.length > 20) {
        const confirmed = await showConfirm(`将一次性打开 ${urls.length} 个链接，可能导致浏览器卡顿。\n建议减少每页条数后分批打开。\n\n是否继续？`);
        if (!confirmed) {
            showToast('已取消打开', 'info');
            return;
        }
    }

    urls.forEach((url, i) => {
        setTimeout(() => openUrl(url.trim()), i * 300);
    });

    showToast(`已开始打开 ${urls.length} 个链接`, 'success');
}

// 下载当前页数据
export function downloadCurrentPage() {
    if (!state.results || state.results.length === 0) {
        showToast('没有可下载的数据', 'error');
        return;
    }

    const fields = getSelectedFields().split(',');
    const data = state.results;
    const filename = `fofa_page${state.currentPage}_${getTimestamp()}.csv`;

    downloadCSV(fields, data, filename);
    incrementDownloads();
    showToast(`已下载第 ${state.currentPage} 页数据 (${data.length} 条)`, 'success');
}

// 下载所有页数据（通过 API 获取）
export async function downloadAllPages() {
    if (!state.currentQuery) {
        showToast('请先执行搜索', 'error');
        return;
    }

    const totalPages = Math.ceil(state.totalResults / parseInt(document.getElementById('pageSize').value));

    // 显示下载对话框
    showDownloadDialog(totalPages);
}

// 显示下载对话框
function showDownloadDialog(totalPages) {
    const maxSize = getMaxSize();
    const canOneClick = state.totalResults <= maxSize;
    const pageSize = parseInt(document.getElementById('pageSize').value);

    // 获取账户信息
    const remainApiData = state.userInfo?.remain_api_data ?? -1;
    const isUnlimited = remainApiData === -1;
    const fofaPoint = state.userInfo?.fofa_point || 0;

    // 计算免费下载量（取maxSize和remainApiData的较小值）
    const freeDownloadLimit = isUnlimited ? maxSize : Math.min(maxSize, remainApiData);

    // 恢复上次保存的页码范围
    const savedRange = restoreDownloadRange();
    const defaultStartPage = savedRange?.startPage || 1;
    const defaultEndPage = savedRange?.endPage || Math.min(totalPages, 10);

    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay show';
    dialog.id = 'downloadModal';
    dialog.innerHTML = `
        <div class="modal">
            <h2 class="modal-title">📥 下载数据</h2>
            <div style="margin-bottom: 16px;">
                <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
                    查询结果共 <strong>${formatNumber(state.totalResults)}</strong> 条，共 <strong>${totalPages}</strong> 页
                </p>
                <div style="background: var(--bg); border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px;">
                    <p>💡 当前每页设置: <strong>${pageSize}</strong> 条</p>
                    <p>💡 账户单次查询限制: <strong>${formatNumber(maxSize)}</strong> 条/次</p>
                    <p>💡 每月免费数据配额: <strong>${isUnlimited ? '不限' : formatNumber(remainApiData)}</strong> 条</p>
                    <p style="color: #22c55e; font-weight: 500;">✅ 免费下载上限: <strong>${formatNumber(freeDownloadLimit)}</strong> 条（不扣F点）</p>
                    ${canOneClick
                        ? '<p style="color: #22c55e;">✅ 结果数未超限，支持一键下载</p>'
                        : '<p style="color: #f59e0b;">⚠️ 结果数超限，超出部分将消耗 F点</p>'
                    }
                </div>

                <div style="background: #fef3c7; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px;">
                    <p style="color: #92400e; font-weight: 500;">⚠️ F点扣费规则</p>
                    <p style="color: #92400e; margin-top: 4px;">
                        • 下载量超过 <strong>${formatNumber(freeDownloadLimit)}</strong> 条时，超出部分消耗 F点<br>
                        • 扣费比例：<strong>1 F点 = 1 条数据</strong><br>
                        • 默认禁止使用 F点，防止意外扣费<br>
                        • 如需下载超出免费上限的数据，请手动开启下方开关
                    </p>
                </div>

                <div class="config-item" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="allowUseFPoints" style="width: 16px; height: 16px; cursor: pointer;">
                    <label for="allowUseFPoints" style="cursor: pointer; user-select: none;">
                        允许使用 F点（当前余额: <strong>${formatNumber(fofaPoint)}</strong>）
                    </label>
                </div>

                <div class="config-item">
                    <label>下载范围</label>
                    <select id="downloadRange">
                        <option value="current">仅当前页</option>
                        ${canOneClick ? '<option value="oneclick" selected>一键下载全部（推荐）</option>' : ''}
                        <option value="custom">自定义页数</option>
                        <option value="all">全部分页下载</option>
                    </select>
                </div>
                <div id="customPageRange" style="display: none; margin-top: 12px;">
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <div class="config-item" style="flex: 1;">
                            <label>起始页</label>
                            <input type="number" id="downloadStartPage" value="${defaultStartPage}" min="1" max="${totalPages}">
                        </div>
                        <div class="config-item" style="flex: 1;">
                            <label>结束页</label>
                            <input type="number" id="downloadEndPage" value="${defaultEndPage}" min="1" max="${totalPages}">
                        </div>
                    </div>
                    <div id="customEstimate" style="margin-top: 8px; font-size: 12px; color: var(--text-secondary); background: var(--bg); border-radius: 4px; padding: 8px;">
                        <p>预估下载: <strong id="estimateCount">${Math.min(10, totalPages) * pageSize}</strong> 条</p>
                        <p>预估API调用: <strong id="estimateCalls">${Math.min(10, totalPages)}</strong> 次</p>
                        <p id="estimateFreeInfo" style="color: #22c55e; margin-top: 4px;">
                            ✅ 在免费范围内，不扣F点
                        </p>
                        <p id="estimateFPoints" style="display: none; color: #dc2626; margin-top: 4px; font-weight: 500;">
                            ⚠️ 超出免费上限 <strong id="estimateOverage">0</strong> 条，将消耗 <strong id="estimateFPointsCount">0</strong> F点
                        </p>
                    </div>
                    <div style="margin-top: 8px; font-size: 11px; color: var(--primary); background: #eff6ff; border-radius: 4px; padding: 8px;">
                        💡 <strong>安全测试建议</strong>：先下载 1-2 页（${pageSize}-${pageSize * 2} 条）测试效果
                    </div>
                </div>

                <div style="margin-top: 12px; padding: 10px; background: var(--bg); border-radius: 6px; font-size: 12px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <label for="downloadConcurrency" style="white-space: nowrap;">⚡ 并发数:</label>
                        <select id="downloadConcurrency" style="flex: 1;">
                            <option value="1">1（串行，最稳定）</option>
                            <option value="3">3（稳定）</option>
                            <option value="5" selected>5（推荐）</option>
                            <option value="10">10（较快）</option>
                            <option value="20">20（激进，可能被限流）</option>
                        </select>
                    </div>
                    <p style="color: var(--text-muted); font-size: 11px;">
                        并发数越高下载越快，但可能触发 FOFA 限流。建议 5-10。
                    </p>
                </div>

                <div id="allDownloadInfo" style="display: none; margin-top: 12px; background: #fef3c7; border-radius: 6px; padding: 10px; font-size: 12px;">
                    <p style="color: #92400e; font-weight: 500;">⚠️ 全部分页下载说明</p>
                    <p style="color: #92400e; margin-top: 4px;">
                        将下载 ${formatNumber(state.totalResults)} 条数据，需要 <strong>${totalPages}</strong> 次API调用。
                        ${state.totalResults > freeDownloadLimit
                            ? `<br><strong style="color: #dc2626;">⚠️ 超出免费上限 ${formatNumber(state.totalResults - freeDownloadLimit)} 条，需消耗 ${formatNumber(state.totalResults - freeDownloadLimit)} F点！</strong>`
                            : '<br><span style="color: #22c55e;">✅ 在免费范围内，不扣F点</span>'
                        }
                    </p>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeDownloadModal()">取消</button>
                <button class="btn btn-primary" id="startDownloadBtn" onclick="startDownload()">开始下载</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    const downloadRange = document.getElementById('downloadRange');
    downloadRange.addEventListener('change', (e) => {
        document.getElementById('customPageRange').style.display =
            e.target.value === 'custom' ? 'block' : 'none';
        document.getElementById('allDownloadInfo').style.display =
            e.target.value === 'all' ? 'block' : 'none';
    });

    // 自定义页数实时计算
    const startInput = document.getElementById('downloadStartPage');
    const endInput = document.getElementById('downloadEndPage');

    function updateEstimate() {
        const start = parseInt(startInput.value) || 1;
        const end = parseInt(endInput.value) || totalPages;
        const pages = Math.max(1, end - start + 1);
        const totalDownload = pages * pageSize;

        document.getElementById('estimateCount').textContent = formatNumber(totalDownload);
        document.getElementById('estimateCalls').textContent = pages;

        // 计算是否超出免费上限
        const estimateFreeInfoEl = document.getElementById('estimateFreeInfo');
        const estimateFPointsEl = document.getElementById('estimateFPoints');
        const estimateOverageEl = document.getElementById('estimateOverage');
        const estimateFPointsCountEl = document.getElementById('estimateFPointsCount');

        if (totalDownload > freeDownloadLimit) {
            const overage = totalDownload - freeDownloadLimit;
            estimateFreeInfoEl.style.display = 'none';
            estimateFPointsEl.style.display = 'block';
            estimateOverageEl.textContent = formatNumber(overage);
            estimateFPointsCountEl.textContent = formatNumber(overage);
        } else {
            estimateFreeInfoEl.style.display = 'block';
            estimateFPointsEl.style.display = 'none';
        }
    }

    startInput.addEventListener('input', updateEstimate);
    endInput.addEventListener('input', updateEstimate);

    // 如果有保存的范围且选择了自定义，自动显示自定义区域并刷新预估
    if (savedRange) {
        downloadRange.value = 'custom';
        document.getElementById('customPageRange').style.display = 'block';
        updateEstimate();
    }
}

// 关闭下载对话框
export function closeDownloadModal() {
    const modal = document.getElementById('downloadModal');
    if (modal) modal.remove();
}

// 开始下载
export async function startDownload() {
    try {
        const range = document.getElementById('downloadRange').value;
        const pageSize = parseInt(document.getElementById('pageSize').value);
        const fields = getSelectedFields();
        const allowUseFPoints = document.getElementById('allowUseFPoints')?.checked || false;
        const concurrency = parseInt(document.getElementById('downloadConcurrency')?.value || '5');
        logInfo('download', '开始下载任务', { range, pageSize, fields, allowUseFPoints, concurrency, query: state.currentQuery });

        // 获取账户信息
        const maxSize = getMaxSize();
        const remainApiData = state.userInfo?.remain_api_data ?? -1;
        const isUnlimited = remainApiData === -1;

        // 计算免费下载上限（取maxSize和remainApiData的较小值）
        const freeDownloadLimit = isUnlimited ? maxSize : Math.min(maxSize, remainApiData);

        let startPage, endPage, totalDownload;

        if (range === 'current') {
            downloadCurrentPage();
            closeDownloadModal();
            return;
        } else if (range === 'oneclick') {
            // 一键下载全部
            totalDownload = state.totalResults;
            startPage = 1;
            endPage = Math.ceil(state.totalResults / pageSize);
        } else if (range === 'custom') {
            startPage = parseInt(document.getElementById('downloadStartPage').value);
            endPage = parseInt(document.getElementById('downloadEndPage').value);
            totalDownload = (endPage - startPage + 1) * pageSize;
            // 保存自定义页码范围设置
            saveDownloadRange(startPage, endPage);
        } else {
            startPage = 1;
            endPage = Math.ceil(state.totalResults / pageSize);
            totalDownload = state.totalResults;
        }

        if (isNaN(startPage) || isNaN(endPage) || startPage > endPage || startPage < 1) {
            showToast('页码范围无效', 'error');
            return;
        }

        // 检查是否超出免费上限
        if (totalDownload > freeDownloadLimit && !allowUseFPoints) {
            const overage = totalDownload - freeDownloadLimit;
            showToast(`下载量超出免费上限 ${formatNumber(overage)} 条，将消耗 ${formatNumber(overage)} F点。请勾选"允许使用F点"后重试`, 'error');
            return;
        }

        const totalPages = endPage - startPage + 1;

        // 自定义分页下载时不关闭弹出层，方便继续设置下一批次
        if (range !== 'custom') {
            closeDownloadModal();
        }

        // 显示统一的进度展示区域
        showDownloadProgress();
        updateDownloadProgress('准备下载...', 0, totalPages);

        if (range === 'oneclick') {
            await downloadAllAtOnce(state.totalResults, fields);
        } else {
            await downloadPageRange(startPage, endPage, pageSize, fields, concurrency);
        }
    } catch (error) {
        logError('download', '下载任务失败', { message: error.message || String(error), query: state.currentQuery });
        showToast(`下载出错: ${error.message || '未知错误'}`, 'error');
        hideDownloadProgress();
    }
}

// 获取账户单次查询最大结果数
function getMaxSize() {
    // 优先使用 API 返回的 maxsize 字段
    const maxsize = state.userInfo?.maxsize || 0;
    if (maxsize > 0) return maxsize;

    // 根据 isvip 判断：VIP 用户 10000 条/次，免费用户 100 条/次
    const isVip = state.userInfo?.isvip || false;
    return isVip ? 10000 : 100;
}

// 获取免费下载上限（不扣F点的最大下载量）
function getFreeDownloadLimit() {
    const maxSize = getMaxSize();
    const remainApiData = state.userInfo?.remain_api_data ?? -1;
    const isUnlimited = remainApiData === -1;
    return isUnlimited ? maxSize : Math.min(maxSize, remainApiData);
}

// 下载指定页数范围的数据
async function downloadPageRange(startPage, endPage, pageSize, fields, concurrency = 5) {
    const totalPages = endPage - startPage + 1;
    const totalToDownload = totalPages * pageSize;
    const maxSize = getMaxSize();

    // 策略选择：如果总数小于等于账户限制，且是连续从第1页开始，一次性查询
    if (totalToDownload <= maxSize && startPage === 1) {
        showToast(`正在一次性下载 ${totalToDownload} 条数据...`, 'info');
        await downloadAllAtOnce(totalToDownload, fields);
    } else {
        showToast(`开始下载第 ${startPage}-${endPage} 页数据（并发: ${concurrency}）...`, 'info');
        await downloadPageByPage(startPage, endPage, pageSize, fields, concurrency);
    }
}

// 一次性下载所有数据（适用于结果数较少的情况）
async function downloadAllAtOnce(size, fields) {
    const maxRetries = 3;
    let retryCount = 0;

    updateDownloadProgress('正在获取数据...', 0, 1);

    while (retryCount < maxRetries) {
        try {
            const data = await fetchSearchResults(state.currentQuery, 1, size, fields);

            if (data.error) {
                throw new Error(data.errmsg || '未知错误');
            }

            if (!data.results || data.results.length === 0) {
                updateDownloadProgress('下载失败', 0, 0, '未获取到数据');
                showToast('未获取到数据', 'error');
                setTimeout(hideDownloadProgress, 3000);
                return;
            }

            updateDownloadProgress('正在保存文件...', 1, 1);

            const fieldList = fields.split(',');
            const filename = `fofa_all_${data.results.length}条_${getTimestamp()}.csv`;
            downloadCSV(fieldList, data.results, filename);
            incrementDownloads();
            incrementDataCount(data.results.length);

            // 计算并统计超出免费上限的F点消耗
            const freeLimit = getFreeDownloadLimit();
            if (data.results.length > freeLimit) {
                const fPointsUsed = data.results.length - freeLimit;
                incrementApiCalls(fPointsUsed);
                updateDownloadProgress('下载完成', 1, 1, `${data.results.length} 条数据已保存（消耗 ${fPointsUsed} F点）`);
                showToast(`下载完成: ${data.results.length} 条数据（消耗 ${fPointsUsed} F点）`, 'success');
            } else {
                updateDownloadProgress('下载完成', 1, 1, `${data.results.length} 条数据已保存`);
                showToast(`下载完成: ${data.results.length} 条数据`, 'success');
            }
            setTimeout(hideDownloadProgress, 5000);
            return;

        } catch (error) {
            retryCount++;
            if (retryCount < maxRetries) {
                updateDownloadProgress(`下载失败，${retryCount}秒后重试...`, 0, 1);
                showToast(`下载失败，${retryCount}秒后重试...`, 'warning');
                await sleep(retryCount * 1000);
            }
        }
    }

    updateDownloadProgress('下载失败', 0, 0, '已重试3次');
    showToast('下载失败，已重试3次', 'error');
    setTimeout(hideDownloadProgress, 3000);
}

// 分页下载（适用于大量数据）
async function downloadPageByPage(startPage, endPage, pageSize, fields, concurrency = 5) {
    const totalPages = endPage - startPage + 1;
    const maxRetries = 2;
    const batchSize = concurrency;

    let allResults = [];
    let failedPages = [];
    let completedPages = 0;

    updateDownloadProgress(`并发下载中（${batchSize}个请求/批）`, 0, totalPages);

    // 分批处理
    for (let batchStart = startPage; batchStart <= endPage; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize - 1, endPage);
        const batchPromises = [];

        // 创建并发请求
        for (let page = batchStart; page <= batchEnd; page++) {
            batchPromises.push(
                fetchWithRetry(state.currentQuery, page, pageSize, fields, maxRetries)
                    .then(data => ({ page, data, success: true }))
                    .catch(error => ({ page, error, success: false }))
            );
        }

        // 等待当前批次完成
        const results = await Promise.all(batchPromises);

        // 处理结果
        for (const result of results) {
            completedPages++;
            if (result.success && result.data && !result.data.error) {
                if (result.data.results && result.data.results.length > 0) {
                    allResults.push(...result.data.results);
                }
            } else {
                failedPages.push(result.page);
            }
        }

        // 更新进度（实时展示）
        const statusText = failedPages.length > 0
            ? `下载中... ${failedPages.length} 页失败`
            : '下载中...';
        updateDownloadProgress(statusText, completedPages, totalPages, `${completedPages} / ${totalPages} 页，已获取 ${allResults.length} 条`);

        // 批次间延迟，避免请求过快被限流（根据并发数动态调整）
        if (batchEnd < endPage) {
            const delay = Math.max(500, concurrency * 200);  // 并发数越大延迟越长
            await sleep(delay);
        }
    }

    if (allResults.length === 0) {
        updateDownloadProgress('下载失败', 0, 0, '未获取到数据');
        showToast('下载失败，未获取到数据', 'error');
        // 延迟隐藏进度区域
        setTimeout(hideDownloadProgress, 3000);
        return;
    }

    const fieldList = fields.split(',');
    const filename = `fofa_pages${startPage}-${endPage}_${allResults.length}条_${getTimestamp()}.csv`;
    downloadCSV(fieldList, allResults, filename);
    incrementDownloads();
    incrementDataCount(allResults.length);

    // 计算并统计超出免费上限的F点消耗
    const freeLimit = getFreeDownloadLimit();
    let msg = `下载完成: ${allResults.length} 条数据`;
    if (allResults.length > freeLimit) {
        const fPointsUsed = allResults.length - freeLimit;
        incrementApiCalls(fPointsUsed);
        msg += `（消耗 ${fPointsUsed} F点）`;
    }
    if (failedPages.length > 0) {
        msg += `，${failedPages.length} 页失败`;
    }

    // 更新进度为完成状态
    updateDownloadProgress('下载完成', totalPages, totalPages, `${allResults.length} 条数据已保存`);
    showToast(msg, failedPages.length > 0 ? 'warning' : 'success');

    // 延迟隐藏进度区域
    setTimeout(hideDownloadProgress, 5000);
}

// 带重试的请求
async function fetchWithRetry(query, page, pageSize, fields, maxRetries) {
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            const data = await fetchSearchResults(query, page, pageSize, fields);
            if (data.error) {
                throw new Error(data.errmsg || '请求失败');
            }
            return data;
        } catch (error) {
            retryCount++;
            if (retryCount >= maxRetries) {
                throw error;
            }
            // 指数退避
            await sleep(retryCount * 500);
        }
    }
}

// 生成 CSV 并下载
function downloadCSV(fields, data, filename) {
    logInfo('download', '导出 CSV', { filename, rowCount: data.length, fields: fields.join(',') });
    const BOM = '﻿';
    const header = fields.map(f => `"${FIELD_LABELS[f] || f}"`).join(',');

    // 根据设置决定是否添加查询元数据行
    const includeQuery = localStorage.getItem(STORAGE_KEYS.exportIncludeQuery) === 'true';
    let metaRow = '';
    if (includeQuery) {
        const queryStr = state.currentQuery || '(无)';
        const exportTime = new Date().toLocaleString('zh-CN', { hour12: false });
        const escapedQuery = String(queryStr).replace(/"/g, '""');
        metaRow = `"查询: ${escapedQuery}    导出时间: ${exportTime}    条数: ${data.length}",` + fields.slice(1).map(() => '').join(',') + '\n';
    }

    const rows = data.map(row =>
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
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// 获取时间戳
function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
