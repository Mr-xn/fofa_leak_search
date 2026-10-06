// js/i18n/index.js - 界面多语言（gettext 风格：源文即 key，仅维护 en 词典）
//
// 约定：
// - key 就是界面上的中文原文（模板字符串中的 ${expr} 写成 {{param}} 并传参）
// - zh-CN 为恒等语言（不建词典），en 缺词条时回退显示中文原文，绝不暴露 key
// - 各源文件的英文词条放在 locales/en/<源文件名>.js，导出 default 平铺对象
import enHtml from './locales/en/html.js';
import enMain from './locales/en/main.js';
import enUi from './locales/en/ui.js';
import enSmartDownloader from './locales/en/smart-downloader.js';
import enResults from './locales/en/results.js';
import enSearch from './locales/en/search.js';
import enFavorites from './locales/en/favorites.js';
import enIconHash from './locales/en/icon-hash.js';
import enQuota from './locales/en/quota.js';
import enStorage from './locales/en/storage.js';
import enStats from './locales/en/stats.js';
import enUtils from './locales/en/utils.js';
import enUserInfo from './locales/en/user-info.js';
import enUpdater from './locales/en/updater.js';
import enApi from './locales/en/api.js';
import enTauriBridge from './locales/en/tauri-bridge.js';
import enScreenshot from './locales/en/screenshot.js';
import enLogger from './locales/en/logger.js';
import enConfig from './locales/en/config.js';
import enFofaRules from './locales/en/fofa-rules.js';

const EN = Object.assign({}, enHtml, enMain, enUi, enSmartDownloader, enResults,
    enSearch, enFavorites, enIconHash, enQuota, enStorage, enStats, enUtils,
    enUserInfo, enUpdater, enApi, enTauriBridge, enScreenshot, enLogger,
    enConfig, enFofaRules);

export const LANG_STORAGE_KEY = 'fofa_lang';
export const SUPPORTED_LANGS = { 'zh-CN': '简体中文', 'en': 'English' };

function guessLang(locale) {
    return /^zh/i.test(String(locale || '')) ? 'zh-CN' : 'en';
}

function detectLang() {
    try {
        const saved = localStorage.getItem(LANG_STORAGE_KEY);
        if (saved && SUPPORTED_LANGS[saved]) return saved;
    } catch { /* localStorage 不可用时走系统语言 */ }
    return guessLang(typeof navigator !== 'undefined' ? navigator.language : '');
}

let currentLang = detectLang();

export function getLang() {
    return currentLang;
}

export function setLang(lang) {
    if (!SUPPORTED_LANGS[lang]) return;
    currentLang = lang;
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* 忽略 */ }
}

/**
 * 取翻译文案。key 即中文源文；en 词典缺省时原样返回（显示中文），不会出现裸 key
 * @param {string} key - 中文源文（模板参数写成 {{param}}）
 * @param {object} [params] - 模板参数
 * @returns {string}
 */
export function t(key, params) {
    if (key == null) return '';
    let s = currentLang === 'en' ? (Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key) : key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            s = s.split(`{{${k}}}`).join(String(v));
        }
    }
    return s;
}

function translateTextNode(node) {
    const src = node.nodeValue;
    const key = src.trim();
    if (!key) return;
    const out = t(key);
    if (out === key) return;
    node.nodeValue = src.replace(key, () => out);
}

/**
 * 把 DOM 树中的静态中文换成当前语言：
 * - [data-i18n]            元素文本（逐个文本节点翻译，保留 svg 等子元素）
 * - [data-i18n-placeholder] placeholder 属性
 * - [data-i18n-title]      title 属性
 */
export function applyI18n(root = document) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.childNodes.forEach(node => {
            if (node.nodeType === 3) translateTextNode(node);
        });
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const v = el.getAttribute('placeholder');
        if (v) el.setAttribute('placeholder', t(v.trim()));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const v = el.getAttribute('title');
        if (v) el.setAttribute('title', t(v.trim()));
    });
    if (root === document) {
        document.documentElement.lang = currentLang;
    }
}

/**
 * 启动初始化：Tauri 下以 Rust 读取的 LANG/LC_* 为准（Linux WebKit 的
 * navigator.language 不一定反映系统 locale），再翻译静态 DOM 并绑定语言切换。
 * 未手动设置过语言时才做自动判定；手动选择优先。
 */
export async function initI18n() {
    let manual = false;
    try { manual = !!localStorage.getItem(LANG_STORAGE_KEY); } catch { /* 忽略 */ }

    if (!manual && typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        try {
            const locale = await window.__TAURI_INTERNALS__.invoke('get_system_locale');
            if (locale) {
                const guessed = guessLang(locale);
                if (guessed !== currentLang) {
                    currentLang = guessed;
                }
            }
        } catch { /* 取不到系统语言时维持 navigator.language 判定 */ }
    }

    applyI18n();

    const sel = document.getElementById('langSelect');
    if (sel) {
        sel.value = currentLang;
        sel.addEventListener('change', () => {
            setLang(sel.value);
            location.reload();
        });
    }
}
