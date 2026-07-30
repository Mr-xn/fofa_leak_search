// js/screenshot.js - 通用 DOM 节点 → PNG 下载（基于本地内置 html2canvas）

/**
 * 生成本地时间戳字符串 YYYYMMDD-HHmmss
 * @returns {string}
 */
function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 触发浏览器下载（沿用项目现有 Blob+createObjectURL+<a download> 模式）
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 把 DOM 节点渲染为 PNG 并下载
 * @param {HTMLElement|null|undefined} node
 * @param {string} filenamePrefix - 文件名前缀（不含扩展名）
 * @returns {Promise<void>}
 * @throws {Error} 节点不存在 / 截图库未加载 / html2canvas 内部错
 */
export async function downloadNodeScreenshot(node, filenamePrefix) {
    if (!node) {
        throw new Error('节点不存在');
    }
    if (typeof window.html2canvas !== 'function') {
        throw new Error('截图库未加载');
    }
    const canvas = await window.html2canvas(node, {
        backgroundColor: null,
        scale: window.devicePixelRatio || 2,
        logging: false,
        useCORS: true,
    });
    const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) {
        throw new Error('生成图片失败');
    }
    triggerDownload(blob, `${filenamePrefix}_${timestamp()}.png`);
}
