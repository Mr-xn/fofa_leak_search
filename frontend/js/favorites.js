// js/favorites.js - 收藏功能（存储、查询、渲染、填充）

import { state, STORAGE_KEYS } from './config.js';
import { escapeHtml, formatTime, showToast } from './utils.js';
import { restoreFiltersFromData, getFilterQuery, getActiveFiltersData } from './ui.js';
import { updateSearchButtonState } from './search.js';
import { FOFA_RULES } from './fofa-rules.js';

// ==================== 存储操作 ====================

const MAX_FAVORITES = 100;
const SEED_MARKER_KEY = 'fofa_rules_seeded';

function persistFavorites() {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(state.favorites));
}

/**
 * 添加收藏
 * @param {string} baseQuery - 基础查询（不含筛选条件）
 * @param {object|null} filtersData - 筛选条件数据
 * @param {string} mergedQuery - 合并后的完整查询语句
 */
export function addFavorite(baseQuery, filtersData, mergedQuery) {
    if (!baseQuery || !baseQuery.trim()) return;

    // 去重前保留旧的 name 和 tags（如果有自定义设置）
    const existing = state.favorites.find(f => f.baseQuery === baseQuery && !f.system);

    // 去重：移除相同 baseQuery 的旧条目
    state.favorites = state.favorites.filter(f => f.baseQuery !== baseQuery);

    // 添加到最前面
    state.favorites.unshift({
        query: mergedQuery,
        baseQuery: baseQuery,
        name: (existing && existing.name) || '',
        tags: (existing && existing.tags) || ['用户'],
        filters: filtersData || null,
        time: new Date().toISOString()
    });

    // 上限裁剪
    if (state.favorites.length > MAX_FAVORITES) {
        state.favorites = state.favorites.slice(0, MAX_FAVORITES);
    }

    persistFavorites();
}

/**
 * 删除收藏
 * @param {string} baseQuery - 基础查询
 */
export function removeFavorite(baseQuery) {
    const target = state.favorites.find(f => f.baseQuery === baseQuery);
    if (target && target.system) return; // 系统规则不可删除
    state.favorites = state.favorites.filter(f => f.baseQuery !== baseQuery);
    persistFavorites();
}

/**
 * 判断是否已收藏
 * @param {string} baseQuery
 * @returns {boolean}
 */
export function isFavorite(baseQuery) {
    if (!baseQuery) return false;
    return state.favorites.some(f => f.baseQuery === baseQuery);
}

/**
 * 判断 baseQuery 是否属于内置（系统）规则
 * @param {string} baseQuery
 * @returns {boolean}
 */
export function isSystemFavorite(baseQuery) {
    if (!baseQuery) return false;
    return state.favorites.some(f => f.system === true && f.baseQuery === baseQuery);
}

/**
 * 获取收藏列表
 * @param {string} [filterText] - 可选的过滤文本（模糊匹配）
 * @returns {Array}
 */
export function getFavorites(filterText) {
    if (!filterText || !filterText.trim()) {
        return [...state.favorites];
    }
    const keyword = filterText.trim().toLowerCase();
    return state.favorites.filter(f =>
        f.baseQuery.toLowerCase().includes(keyword) ||
        f.query.toLowerCase().includes(keyword) ||
        (f.name && f.name.toLowerCase().includes(keyword))
    );
}

/**
 * 切换收藏状态
 * @param {string} baseQuery
 * @param {object|null} filtersData
 * @param {string} mergedQuery
 * @returns {'added'|'removed'|'noop'}
 */
export function toggleFavorite(baseQuery, filtersData, mergedQuery) {
    if (!baseQuery || !baseQuery.trim()) return 'noop';

    // 系统规则不可切换收藏
    if (isSystemFavorite(baseQuery)) return 'noop';

    if (isFavorite(baseQuery)) {
        removeFavorite(baseQuery);
        return 'removed';
    } else {
        addFavorite(baseQuery, filtersData, mergedQuery);
        return 'added';
    }
}

/**
 * 清除全部收藏
 */
export function clearAllFavorites() {
    state.favorites = state.favorites.filter(f => f.system === true);
    persistFavorites();
}

/**
 * 清除全部用户收藏 + 刷新 UI（供 HTML onclick 调用）
 */
export function handleClearAllFavorites() {
    clearAllFavorites();
    const searchText = document.getElementById('favSearchInput')?.value || '';
    renderFavoritesList(searchText);
    updateFavCount();
    updateFavoriteButtonState();
}

/**
 * 更新用户收藏的别名
 * @param {string} baseQuery
 * @param {string} newName
 * @returns {boolean}
 */
export function updateFavoriteName(baseQuery, newName) {
    if (!baseQuery || !newName || !newName.trim()) return false;
    const fav = state.favorites.find(f => f.baseQuery === baseQuery);
    if (!fav || fav.system) return false;
    fav.name = newName.trim();
    persistFavorites();
    return true;
}

/**
 * 更新用户收藏的标签（始终保留 "用户" 标签）
 * @param {string} baseQuery
 * @param {string[]} tags
 * @returns {boolean}
 */
export function updateFavoriteTags(baseQuery, tags) {
    if (!baseQuery) return false;
    const fav = state.favorites.find(f => f.baseQuery === baseQuery);
    if (!fav || fav.system) return false;
    // 始终包含 '用户'，去重
    const merged = ['用户', ...(tags || []).filter(t => t !== '用户')];
    fav.tags = [...new Set(merged)];
    persistFavorites();
    return true;
}

/**
 * 从所有用户收藏中删除指定标签（不影响系统规则和内置标签）
 * @param {string} tag - 要删除的标签名
 * @returns {number} 受影响的收藏数
 */
export function deleteCustomTag(tag) {
    if (!tag || tag === '用户') return 0;
    const builtin = _getBuiltinTags();
    if (builtin.has(tag)) return 0;

    let count = 0;
    for (const f of state.favorites) {
        if (f.system || !Array.isArray(f.tags)) continue;
        const before = f.tags.length;
        f.tags = f.tags.filter(t => t !== tag);
        if (f.tags.length < before) count++;
    }
    if (count > 0) persistFavorites();
    return count;
}

/**
 * 重命名所有用户收藏中的自定义标签（不影响系统规则和内置标签）
 * @param {string} oldTag - 旧标签名
 * @param {string} newTag - 新标签名
 * @returns {number} 受影响的收藏数
 */
export function renameCustomTag(oldTag, newTag) {
    if (!oldTag || !newTag || !newTag.trim()) return 0;
    if (oldTag === '用户' || newTag.trim() === '用户') return 0;
    const builtin = _getBuiltinTags();
    if (builtin.has(oldTag)) return 0;

    const newName = newTag.trim();
    let count = 0;
    for (const f of state.favorites) {
        if (f.system || !Array.isArray(f.tags)) continue;
        if (!f.tags.includes(oldTag)) continue;
        // 替换并去重
        const replaced = f.tags.map(t => t === oldTag ? newName : t);
        f.tags = [...new Set(replaced)];
        count++;
    }
    if (count > 0) persistFavorites();
    return count;
}

// ==================== 系统规则播种 ====================

/**
 * 构造内置规则收藏条目（含 name/tags）
 * @param {string} now
 * @returns {Array}
 */
function _buildSystemFavorites(now) {
    return FOFA_RULES.map(r => ({
        query: r.query,
        baseQuery: r.query,
        name: r.name,
        tags: Array.isArray(r.tags) ? r.tags.slice() : [],
        filters: null,
        time: now,
        system: true
    }));
}

/**
 * 首次加载时种子内置规则到收藏列表。
 * 已播种过的旧数据会触发迁移：以当前 FOFA_RULES 为基准重建系统规则部分，
 * 补齐 name/tags 等新字段，并在规则库条数变化时同步增删（用户自定义收藏保留）。
 */
export function seedSystemRules() {
    const now = new Date().toISOString();
    const systemFavs = _buildSystemFavorites(now);

    if (!localStorage.getItem(SEED_MARKER_KEY)) {
        // 首次播种
        state.favorites = [...state.favorites, ...systemFavs];
        persistFavorites();
        localStorage.setItem(SEED_MARKER_KEY, '1');
        return;
    }

    // 已播种：判断是否需要迁移/重建系统规则
    const oldSystem = state.favorites.filter(f => f.system === true);
    const userFavs = state.favorites.filter(f => f.system !== true);

    // 需要迁移的条件：数量不一致，或任一系统规则缺 name/tags 或 query 不匹配
    const needsMigration = oldSystem.length !== systemFavs.length ||
        oldSystem.some((f, i) => !f.name || !Array.isArray(f.tags) ||
            systemFavs[i] && (f.query !== systemFavs[i].query));

    if (needsMigration) {
        // 保留用户收藏在前，重建后的系统规则在后
        state.favorites = [...userFavs, ...systemFavs];
        persistFavorites();
    }
}

// ==================== UI 渲染 ====================

/** 缓存当前渲染的收藏列表，供事件委托按索引查找 */
let _renderedFavorites = [];

/** 当前激活的标签筛选（null 表示"全部"） */
let _activeTag = null;

/** 内置标签集合（惰性初始化） */
let _builtinTags = null;
function _getBuiltinTags() {
    if (_builtinTags) return _builtinTags;
    _builtinTags = new Set();
    FOFA_RULES.forEach(r => {
        if (Array.isArray(r.tags)) r.tags.forEach(t => _builtinTags.add(t));
    });
    return _builtinTags;
}

// 预构建 SVG 图标字符串，避免每条收藏重复创建（WebKit2GTK 性能优化）
const _SVG_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
const _SVG_EDIT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const _SVG_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/**
 * 从收藏列表中聚合所有标签，按出现频次降序排序。
 * 优先展示 "用户" 标签和用户自定义标签，内置标签按频次补位。
 * @param {Array} favorites
 * @returns {Array<{tag: string, count: number}>}
 */
function _aggregateTags(favorites) {
    const counts = new Map();
    for (const f of favorites) {
        if (!Array.isArray(f.tags) || f.tags.length === 0) continue;
        for (const t of f.tags) {
            counts.set(t, (counts.get(t) || 0) + 1);
        }
    }
    const builtin = _getBuiltinTags();
    const all = Array.from(counts.entries()).map(([tag, count]) => ({ tag, count }));

    // 分组：用户标签、自定义标签、内置标签
    const userTag = all.find(t => t.tag === '用户');
    const customTags = all.filter(t => t.tag !== '用户' && !builtin.has(t.tag))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const builtinTags = all.filter(t => t.tag !== '用户' && builtin.has(t.tag))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    // 拼接："全部" 始终在最前，"用户" 次之，自定义随后，内置补位
    const result = [];
    if (userTag) result.push(userTag);
    result.push(...customTags);
    result.push(...builtinTags);
    return result;
}

/**
 * 渲染标签筛选 chip 行
 * @param {Array<{tag: string, count: number}>} tags
 */
function _renderChips(tags) {
    const chipsEl = document.getElementById('favChips');
    const actionsEl = document.getElementById('favChipsActions');
    if (!chipsEl) return;

    // 无可用标签时隐藏整行
    if (!tags.length) {
        chipsEl.innerHTML = '';
        chipsEl.style.display = 'none';
        if (actionsEl) actionsEl.style.display = 'none';
        return;
    }
    chipsEl.style.display = '';

    const allChip = `<button class="fav-chip${_activeTag === null ? ' is-active' : ''}" data-tag="">全部</button>`;
    const tagChips = tags.map(({ tag, count }) =>
        `<button class="fav-chip${_activeTag === tag ? ' is-active' : ''}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}<span class="fav-chip-count">${count}</span></button>`
    ).join('');

    chipsEl.innerHTML = allChip + tagChips;
    chipsEl.classList.remove('expanded');

    // 显示展开/收起按钮（标签超过可显示行数时才有意义）
    if (actionsEl) {
        actionsEl.style.display = tags.length > 4 ? '' : 'none';
        const toggle = actionsEl.querySelector('.fav-chips-toggle');
        if (toggle) toggle.textContent = '展开 ▼';
    }
}

/**
 * 渲染用户收藏的标签 chips
 * @param {object} fav - 收藏条目
 * @param {number} index - 渲染索引
 * @returns {string}
 */
function _renderUserTags(fav, index, builtin) {
    const tags = Array.isArray(fav.tags) ? fav.tags : ['用户'];
    if (tags.length === 0) return '';
    const chips = tags.map(t => {
        const canQuickRemove = t !== '用户' && !builtin.has(t);
        return `<span class="fav-tag-chip${canQuickRemove ? ' fav-tag-chip-removable' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}${canQuickRemove ? `<button class="fav-tag-chip-remove" data-tag-index="${index}" data-tag="${escapeHtml(t)}" title="从当前规则移除此标签">×</button>` : ''}</span>`;
    }).join('');
    return `<div class="fav-user-tags">
        ${chips}
        <button class="fav-tag-add" data-tag-index="${index}" title="编辑标签分组">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
    </div>`;
}

/**
 * 渲染收藏列表 HTML
 * @param {string} [filterText] - 可选的过滤文本
 */
export function renderFavoritesList(filterText) {
    const listEl = document.getElementById('favoritesList');
    const emptyEl = document.getElementById('favoritesEmpty');
    if (!listEl || !emptyEl) return;

    // 文本搜索匹配的收藏（搜索维度不涉及标签，故先按文本过滤）
    const matched = getFavorites(filterText);

    // 标签行基于【文本搜索后的结果】聚合，保证 chip 与当前可见集合一致
    const tags = _aggregateTags(matched);
    _renderChips(tags);

    // 若当前激活的标签在可见集合中已不存在，则重置为"全部"
    if (_activeTag !== null && !tags.some(t => t.tag === _activeTag)) {
        _activeTag = null;
    }

    // 在文本匹配基础上再叠加标签筛选
    const favorites = _activeTag === null
        ? matched
        : matched.filter(f => Array.isArray(f.tags) && f.tags.includes(_activeTag));
    _renderedFavorites = favorites;

    if (favorites.length === 0) {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
        emptyEl.style.display = '';
        return;
    }

    listEl.style.display = '';
    emptyEl.style.display = 'none';

    // 预计算内置标签集合，避免每条收藏重复计算（WebKit2GTK 性能优化）
    const builtin = _getBuiltinTags();

    listEl.innerHTML = favorites.map((f, i) => {
        // 仅前 12 项应用 staggered 渐入，后续项禁用动画，避免长列表合成层开销
        const delay = i < 12 ? ` style="animation-delay:${(i * 24).toFixed(0)}ms"` : '';
        const animClass = i < 12 ? '' : ' fav-item-no-anim';
        if (f.system) {
            const sysTags = Array.isArray(f.tags) && f.tags.length
                ? `<div class="fav-sys-tags">${f.tags.slice(0, 4).map(t => `<span class="fav-tag-ro">#${escapeHtml(t)}</span>`).join('')}</div>`
                : '';
            return `
            <div class="fav-item fav-system${animClass}" data-index="${i}"${delay}>
                <div class="fav-item-main">
                    <div class="fav-sys-head">
                        <span class="fav-sys-name">${escapeHtml(f.name || '未命名规则')}</span>
                        <span class="fav-system-badge">内置</span>
                    </div>
                    <span class="fav-query" title="${escapeHtml(f.query)}">${escapeHtml(f.query)}</span>
                    ${sysTags}
                </div>
                <div class="fav-item-actions">
                    <button class="btn btn-sm fav-fill" data-index="${i}" title="填充到搜索框">${_SVG_CHECK}</button>
                </div>
            </div>`;
        }
        return `
        <div class="fav-item${animClass}" data-index="${i}"${delay}>
            <div class="fav-item-main">
                <div class="fav-name-row">
                    <span class="fav-name" data-name-index="${i}" title="点击编辑别名">${escapeHtml(f.name || f.baseQuery)}</span>
                    <button class="fav-edit-btn" data-edit-index="${i}" title="编辑别名">${_SVG_EDIT}</button>
                </div>
                <span class="fav-query" title="${escapeHtml(f.query)}">${escapeHtml(f.query)}</span>
                ${_renderUserTags(f, i, builtin)}
                <span class="fav-time">${formatTime(f.time)}</span>
            </div>
            <div class="fav-item-actions">
                <button class="btn btn-sm fav-fill" data-index="${i}" title="填充到搜索框">${_SVG_CHECK}</button>
                <button class="btn btn-sm fav-delete" data-index="${i}" title="删除收藏">${_SVG_DELETE}</button>
            </div>
        </div>`;
    }).join('');
}

/**
 * 设置当前激活的标签筛选并重渲染列表（供 chip 点击事件调用）
 * @param {string|null} tag - 标签名，null 表示"全部"
 * @param {string} [filterText] - 当前搜索框文本
 */
export function setActiveFavTag(tag, filterText) {
    _activeTag = tag || null;
    renderFavoritesList(filterText);
}

/**
 * 根据渲染索引获取收藏条目（供事件委托使用）
 * @param {number} index
 * @returns {object|undefined}
 */
export function getRenderedFavorite(index) {
    return _renderedFavorites[index];
}

/**
 * 从收藏条目填充查询到搜索框
 * @param {object} entry - 收藏条目
 */
export function fillFromFavorite(entry) {
    if (!entry) return;

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = entry.baseQuery || '';
        updateSearchButtonState();
    }

    // 恢复筛选条件
    if (entry.filters && Object.keys(entry.filters).length > 0) {
        restoreFiltersFromData(entry.filters);
    }

    // 关闭收藏面板
    const modal = document.getElementById('favoritesPanel');
    if (modal) {
        modal.classList.remove('show');
    }

    showToast('已填充收藏的查询条件', 'success');
}

// ==================== 面板控制 ====================

/**
 * 打开/关闭收藏面板
 */
export function toggleFavoritesPanel() {
    const modal = document.getElementById('favoritesPanel');
    if (!modal) return;

    const isOpen = modal.classList.contains('show');
    if (isOpen) {
        closeFavoritesPanel();
    } else {
        // 打开前刷新列表和按钮状态
        renderFavoritesList();
        updateFavoriteButtonState();
        updateFavCount();
        modal.classList.add('show');
        // 聚焦搜索框
        setTimeout(() => {
            const searchInput = document.getElementById('favSearchInput');
            if (searchInput) searchInput.focus();
        }, 150);
    }
}

/**
 * 关闭收藏面板
 */
export function closeFavoritesPanel() {
    const modal = document.getElementById('favoritesPanel');
    if (modal) {
        modal.classList.remove('show');
    }
    // 清空搜索
    const searchInput = document.getElementById('favSearchInput');
    if (searchInput) searchInput.value = '';
}

/**
 * 更新收藏按钮状态（空心/填实）
 */
export function updateFavoriteButtonState() {
    const btn = document.getElementById('favToggleBtn');
    if (!btn) return;

    // 获取当前基础查询（不含筛选条件）
    const input = document.getElementById('searchInput');
    const baseQuery = input ? input.value.trim() : '';

    if (baseQuery && isSystemFavorite(baseQuery)) {
        btn.classList.add('builtin');
        btn.classList.remove('favorited');
        btn.title = '内置规则，不可取消收藏';
        return;
    }

    btn.classList.remove('builtin');

    if (baseQuery && isFavorite(baseQuery)) {
        btn.classList.add('favorited');
        btn.title = '取消收藏';
    } else {
        btn.classList.remove('favorited');
        btn.title = '收藏当前查询条件';
    }
}

/**
 * 星标按钮点击处理：有查询则切换收藏，无查询则打开面板
 */
export function handleFavoriteClick() {
    const input = document.getElementById('searchInput');
    const baseQuery = input ? input.value.trim() : '';

    if (!baseQuery) {
        // 无查询：打开收藏面板
        toggleFavoritesPanel();
        return;
    }

    // 内置规则不可切换收藏
    if (isSystemFavorite(baseQuery)) {
        showToast('内置规则，不可取消收藏', 'info');
        return;
    }

    // 有查询：切换收藏状态
    const filtersData = getActiveFiltersData();
    const filterQuery = getFilterQuery();
    const mergedQuery = filterQuery ? `${baseQuery} && ${filterQuery}` : baseQuery;

    const result = toggleFavorite(baseQuery, filtersData, mergedQuery);
    if (result === 'added') {
        showToast('已收藏当前查询条件', 'success');
    } else if (result === 'removed') {
        showToast('已取消收藏', 'info');
    }
    updateFavoriteButtonState();
}

/**
 * 更新收藏计数显示
 */
export function updateFavCount() {
    const countEl = document.getElementById('favCount');
    const clearBtn = document.getElementById('favClearAllBtn');
    const count = state.favorites.length;
    if (countEl) countEl.textContent = `${count} 条收藏`;
    if (clearBtn) clearBtn.style.display = count > 0 ? '' : 'none';
}
