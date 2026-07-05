// js/icon-hash.js - Icon Hash 计算 (MurmurHash3 32-bit + Base64)

import { showToast } from './utils.js';
import { updateFilterInput } from './ui.js';
import { info as logInfo, error as logError } from './logger.js';

// ==================== 32-bit 整数运算辅助 ====================

/**
 * 32-bit 循环左移
 */
function rotl32(x, r) {
    return ((x << r) | (x >>> (32 - r))) >>> 0;
}

/**
 * 32-bit 乘法（保持 uint32 溢出语义）
 */
function mul32(a, b) {
    return Math.imul(a, b) >>> 0;
}

// ==================== MurmurHash3 32-bit (x86) ====================

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

/**
 * MurmurHash3 x86 32-bit
 * @param {string|Uint8Array} data - 输入数据
 * @param {number} [seed=0] - 哈希种子
 * @returns {number} uint32 哈希值
 */
export function mmh3_32(data, seed = 0) {
    // 统一转为字节数组
    let bytes;
    if (typeof data === 'string') {
        bytes = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
        bytes = data;
    } else {
        bytes = new Uint8Array([]);
    }

    const len = bytes.length;
    const nblocks = len >>> 2; // Math.floor(len / 4)

    let h1 = seed >>> 0;

    // 处理 4 字节块
    for (let i = 0; i < nblocks; i++) {
        const off = i << 2;
        let k1 = (bytes[off] & 0xff)
            | ((bytes[off + 1] & 0xff) << 8)
            | ((bytes[off + 2] & 0xff) << 16)
            | ((bytes[off + 3] & 0xff) << 24);
        k1 = k1 >>> 0;

        k1 = mul32(k1, C1);
        k1 = rotl32(k1, 15);
        k1 = mul32(k1, C2);

        h1 ^= k1;
        h1 = rotl32(h1, 13);
        h1 = mul32(h1, 5) + 0xe6546b64 >>> 0;
    }

    // 处理尾部
    const tail = bytes.slice(nblocks << 2);
    let k1 = 0;

    switch (tail.length) {
        case 3:
            k1 ^= (tail[2] & 0xff) << 16;
        case 2:
            k1 ^= (tail[1] & 0xff) << 8;
        case 1:
            k1 ^= (tail[0] & 0xff);
            k1 = mul32(k1, C1);
            k1 = rotl32(k1, 15);
            k1 = mul32(k1, C2);
            h1 ^= k1;
    }

    // 最终化
    h1 ^= len;

    h1 ^= h1 >>> 16;
    h1 = mul32(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = mul32(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
}

// ==================== Base64 处理 ====================

/**
 * 将 Uint8Array 转换为 Base64 字符串
 */
export function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Base64 字符串按76字符换行 + 末尾换行（匹配 FOFA Go 实现）
 * @param {string} b64Str - 不含换行的 Base64 字符串
 * @returns {string} - 带换行的 Base64 字符串
 */
export function base64Wrap(b64Str) {
    let result = '';
    for (let i = 0; i < b64Str.length; i++) {
        result += b64Str[i];
        if ((i + 1) % 76 === 0) {
            result += '\n';
        }
    }
    result += '\n';
    return result;
}

// ==================== 类型转换 ====================

/**
 * 将 uint32 转为有符号 int32
 * @param {number} uint32 - 无符号 32 位整数
 * @returns {number} - 有符号 32 位整数
 */
export function uint32ToInt32(uint32) {
    return uint32 | 0;
}

// ==================== 主流程 ====================

/**
 * 计算 FOFA icon_hash
 * @param {Uint8Array} faviconBytes - favicon 文件的原始字节
 * @returns {string} - 十进制有符号整数字符串（如 "-123456789"）
 */
export function computeIconHash(faviconBytes) {
    // 1. Base64 编码
    const b64 = bytesToBase64(faviconBytes);

    // 2. 按 76 字符换行 + 末尾 \n
    const wrapped = base64Wrap(b64);

    // 3. MurmurHash3 32-bit (seed=0)
    const hashUint32 = mmh3_32(wrapped, 0);

    // 4. 转为有符号 int32
    const hashInt32 = uint32ToInt32(hashUint32);

    // 5. 返回十进制字符串
    return String(hashInt32);
}

// ==================== UI 交互 ====================

let _lastIconHash = '';

/**
 * 打开 Icon Hash 计算弹窗
 */
export function showIconHashModal() {
    document.getElementById('iconHashModal').classList.add('show');
    // 重置状态
    _lastIconHash = '';
    document.getElementById('iconHashResult').classList.remove('show');
    document.getElementById('iconHashValue').textContent = '—';
    document.getElementById('iconHashUrlInput').value = '';
    document.getElementById('iconHashUrlInput').focus();

    // 初始化拖拽上传
    initDropzone();
}

/**
 * 初始化拖拽上传区域
 */
function initDropzone() {
    const zone = document.getElementById('iconHashDropzone');
    if (!zone || zone._dragInit) return;
    zone._dragInit = true;

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    });
}

/**
 * 关闭弹窗
 */
export function closeIconHashModal() {
    document.getElementById('iconHashModal').classList.remove('show');
}

/**
 * 从 URL 获取 favicon 并计算 hash
 */
export async function fetchIconFromUrl() {
    const urlInput = document.getElementById('iconHashUrlInput');
    const url = urlInput.value.trim();
    if (!url) {
        showToast('请输入 favicon URL', 'error');
        return;
    }

    showToast('正在获取 favicon...', 'info');
    logInfo('iconhash', '开始获取 favicon', { url });
    try {
        const response = await fetch(url);
        logInfo('iconhash', 'favicon 响应', { url, status: response.status, ok: response.ok });
        if (!response.ok) {
            showToast(`获取失败: HTTP ${response.status}`, 'error');
            return;
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const hash = computeIconHash(bytes);
        logInfo('iconhash', 'favicon hash 计算完成', { url, byteLength: bytes.length, hash });
        showIconHashResult(hash);
        showToast('计算完成', 'success');
    } catch (e) {
        logError('iconhash', 'favicon 获取失败', { url, message: e.message || String(e) });
        showToast(`获取失败: ${e.message}`, 'error');
    }
}

/**
 * 处理文件选择（input[type=file] onchange）
 */
export function handleIconFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    processFile(file);
    // 重置 input 以允许重复选择同一文件
    event.target.value = '';
}

/**
 * 读取文件并计算 hash
 */
function processFile(file) {
    showToast('正在计算...', 'info');
    const reader = new FileReader();
    reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        const hash = computeIconHash(bytes);
        showIconHashResult(hash);
        showToast('计算完成', 'success');
    };
    reader.onerror = () => {
        showToast('文件读取失败', 'error');
    };
    reader.readAsArrayBuffer(file);
}

/**
 * 显示计算结果
 */
function showIconHashResult(hash) {
    _lastIconHash = hash;
    document.getElementById('iconHashValue').textContent = hash;
    document.getElementById('iconHashResult').classList.add('show');
}

/**
 * 复制 hash 到剪贴板
 */
export async function copyIconHash() {
    if (!_lastIconHash) {
        showToast('请先计算 hash', 'error');
        return;
    }
    try {
        await navigator.clipboard.writeText(_lastIconHash);
        showToast('已复制到剪贴板', 'success');
    } catch {
        // 降级方案：部分 WebView 环境不支持 clipboard API
        const textarea = document.createElement('textarea');
        textarea.value = _lastIconHash;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showToast('已复制到剪贴板', 'success');
        } catch {
            showToast('复制失败', 'error');
        }
        document.body.removeChild(textarea);
    }
}

/**
 * 将 hash 填入筛选条件
 */
export function applyIconHashFilter() {
    if (!_lastIconHash) {
        showToast('请先计算 hash', 'error');
        return;
    }
    // 使用 icon_hash 筛选
    updateFilterInput('icon_hash', _lastIconHash);
    closeIconHashModal();
    showToast(`已填入筛选: icon_hash="${_lastIconHash}"`, 'success');
}
