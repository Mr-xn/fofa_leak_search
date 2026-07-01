// js/favorites.test.js - 收藏功能测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 辅助：在每个 describe 中重置 state.favorites（单例 state 跨测试共享）
async function resetState() {
    const configMod = await import('./config.js');
    configMod.state.favorites = [];
    localStorage.setItem('fofa_favorites', '[]');
}

// ==================== 存储 CRUD 测试 ====================

describe('addFavorite', () => {
    let addFavorite, getFavorites, state, STORAGE_KEYS;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const configMod = await import('./config.js');
        state = configMod.state;
        STORAGE_KEYS = configMod.STORAGE_KEYS;

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('应保存一条新的收藏', () => {
        addFavorite('title="login"', { key1: { filter: 'country', value: 'CN' } }, 'title="login" && country="CN"');

        const favorites = getFavorites();
        expect(favorites.length).toBe(1);
        expect(favorites[0].baseQuery).toBe('title="login"');
        expect(favorites[0].query).toBe('title="login" && country="CN"');
        expect(favorites[0].filters).toEqual({ key1: { filter: 'country', value: 'CN' } });
        expect(favorites[0].time).toBeTruthy();
    });

    it('保存后应持久化到 localStorage', () => {
        addFavorite('port="80"', null, 'port="80"');

        const raw = localStorage.getItem(STORAGE_KEYS.favorites);
        const parsed = JSON.parse(raw);
        expect(parsed.length).toBe(1);
        expect(parsed[0].baseQuery).toBe('port="80"');
    });

    it('相同 baseQuery 应去重（替换旧条目）', () => {
        addFavorite('test', { a: 1 }, 'test && a="1"');
        addFavorite('test', { b: 2 }, 'test && b="2"');

        const favorites = getFavorites();
        expect(favorites.length).toBe(1);
        expect(favorites[0].query).toBe('test && b="2"');
    });

    it('新收藏应放在列表最前面', () => {
        addFavorite('first', null, 'first');
        addFavorite('second', null, 'second');

        const favorites = getFavorites();
        expect(favorites[0].baseQuery).toBe('second');
        expect(favorites[1].baseQuery).toBe('first');
    });

    it('空字符串不应保存', () => {
        addFavorite('', null, '');
        const favorites = getFavorites();
        expect(favorites.length).toBe(0);
    });

    it('纯空格不应保存', () => {
        addFavorite('   ', null, '   ');
        const favorites = getFavorites();
        expect(favorites.length).toBe(0);
    });

    it('收藏数量上限为 100 条', () => {
        for (let i = 0; i < 150; i++) {
            addFavorite(`query_${i}`, null, `query_${i}`);
        }
        const favorites = getFavorites();
        expect(favorites.length).toBeLessThanOrEqual(100);
    });

    it('应同步更新 state.favorites', () => {
        addFavorite('state_test', null, 'state_test');
        expect(state.favorites.length).toBe(1);
        expect(state.favorites[0].baseQuery).toBe('state_test');
    });
});

describe('removeFavorite', () => {
    let addFavorite, removeFavorite, getFavorites, state;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const configMod = await import('./config.js');
        state = configMod.state;

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        removeFavorite = mod.removeFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('应删除指定 baseQuery 的收藏', () => {
        addFavorite('keep', null, 'keep');
        addFavorite('delete_me', null, 'delete_me');

        removeFavorite('delete_me');

        const favorites = getFavorites();
        expect(favorites.length).toBe(1);
        expect(favorites[0].baseQuery).toBe('keep');
    });

    it('删除不存在的收藏不应报错', () => {
        addFavorite('exists', null, 'exists');
        expect(() => removeFavorite('nonexistent')).not.toThrow();
        expect(getFavorites().length).toBe(1);
    });

    it('删除后应更新 localStorage', () => {
        addFavorite('test', null, 'test');
        removeFavorite('test');

        const raw = localStorage.getItem('fofa_favorites');
        const parsed = JSON.parse(raw);
        expect(parsed.length).toBe(0);
    });

    it('应同步更新 state.favorites', () => {
        addFavorite('test', null, 'test');
        removeFavorite('test');
        expect(state.favorites.length).toBe(0);
    });
});

describe('isFavorite', () => {
    let addFavorite, isFavorite, removeFavorite;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        isFavorite = mod.isFavorite;
        removeFavorite = mod.removeFavorite;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('已收藏的查询应返回 true', () => {
        addFavorite('title="admin"', null, 'title="admin"');
        expect(isFavorite('title="admin"')).toBe(true);
    });

    it('未收藏的查询应返回 false', () => {
        expect(isFavorite('not_favorited')).toBe(false);
    });

    it('删除后应返回 false', () => {
        addFavorite('temp', null, 'temp');
        removeFavorite('temp');
        expect(isFavorite('temp')).toBe(false);
    });

    it('空字符串应返回 false', () => {
        expect(isFavorite('')).toBe(false);
    });

    it('null 应返回 false', () => {
        expect(isFavorite(null)).toBe(false);
    });
});

describe('getFavorites', () => {
    let addFavorite, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('无收藏时应返回空数组', () => {
        expect(getFavorites()).toEqual([]);
    });

    it('应返回所有收藏（按时间倒序）', () => {
        addFavorite('a', null, 'a');
        addFavorite('b', null, 'b');
        addFavorite('c', null, 'c');

        const list = getFavorites();
        expect(list.length).toBe(3);
        // 最新添加的在前
        expect(list[0].baseQuery).toBe('c');
    });

    it('传入过滤文本应模糊匹配', () => {
        addFavorite('title="login"', null, 'title="login"');
        addFavorite('body="admin"', null, 'body="admin"');
        addFavorite('port="80"', null, 'port="80"');

        const filtered = getFavorites('login');
        expect(filtered.length).toBe(1);
        expect(filtered[0].baseQuery).toBe('title="login"');
    });

    it('过滤文本应匹配 query 字段', () => {
        addFavorite('base', { x: 1 }, 'base && x="test_value"');

        const filtered = getFavorites('test_value');
        expect(filtered.length).toBe(1);
    });

    it('过滤文本大小写不敏感', () => {
        addFavorite('TITLE="Admin"', null, 'TITLE="Admin"');

        const filtered = getFavorites('admin');
        expect(filtered.length).toBe(1);
    });

    it('空过滤文本应返回全部', () => {
        addFavorite('a', null, 'a');
        addFavorite('b', null, 'b');

        expect(getFavorites('').length).toBe(2);
        expect(getFavorites(null).length).toBe(2);
    });
});

describe('toggleFavorite', () => {
    let addFavorite, toggleFavorite, isFavorite, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        toggleFavorite = mod.toggleFavorite;
        isFavorite = mod.isFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('未收藏时 toggle 应添加收藏', () => {
        const result = toggleFavorite('test', null, 'test');
        expect(result).toBe('added');
        expect(isFavorite('test')).toBe(true);
    });

    it('已收藏时 toggle 应移除收藏', () => {
        addFavorite('test', null, 'test');
        const result = toggleFavorite('test', null, 'test');
        expect(result).toBe('removed');
        expect(isFavorite('test')).toBe(false);
    });

    it('空查询不应操作', () => {
        const result = toggleFavorite('', null, '');
        expect(result).toBe('noop');
        expect(getFavorites().length).toBe(0);
    });
});

describe('clearAllFavorites', () => {
    let addFavorite, clearAllFavorites, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        clearAllFavorites = mod.clearAllFavorites;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('应清除所有收藏', () => {
        addFavorite('a', null, 'a');
        addFavorite('b', null, 'b');

        clearAllFavorites();

        expect(getFavorites().length).toBe(0);
    });

    it('清除后 localStorage 应为空数组', () => {
        addFavorite('test', null, 'test');
        clearAllFavorites();

        const raw = localStorage.getItem('fofa_favorites');
        expect(JSON.parse(raw)).toEqual([]);
    });
});

// ==================== DOM 渲染测试 ====================

describe('renderFavoritesList', () => {
    let addFavorite, renderFavoritesList, clearAllFavorites;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();
        document.body.innerHTML = `
            <input type="text" id="searchInput" value="" />
            <div id="favoritesList"></div>
            <div id="favoritesEmpty"></div>
        `;

        const mod = await import('./favorites.js');
        addFavorite = mod.addFavorite;
        renderFavoritesList = mod.renderFavoritesList;
        clearAllFavorites = mod.clearAllFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('无收藏时应显示空状态', () => {
        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        const empty = document.getElementById('favoritesEmpty');
        expect(list.innerHTML).toBe('');
        expect(empty.style.display).not.toBe('none');
    });

    it('有收藏时应渲染列表并隐藏空状态', () => {
        addFavorite('test_query', null, 'test_query');

        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        const empty = document.getElementById('favoritesEmpty');
        expect(list.innerHTML).toContain('test_query');
        expect(empty.style.display).toBe('none');
    });

    it('每条收藏应有填充和删除按钮', () => {
        addFavorite('test', null, 'test');

        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        expect(list.innerHTML).toContain('fav-fill');
        expect(list.innerHTML).toContain('fav-delete');
    });

    it('收藏列表应包含每条的时间戳', () => {
        addFavorite('timed', null, 'timed');

        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        // 时间格式化为中文格式，至少包含 "分钟前" / "小时前" / "天前" / "刚刚" 或日期
        expect(list.innerHTML).toMatch(/前|刚刚|[\d]{4}/);
    });
});

describe('fillFromFavorite', () => {
    let fillFromFavorite, addFavorite, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        await resetState();
        document.body.innerHTML = `
            <div id="toast"></div>
            <input type="text" id="searchInput" value="" />
            <div id="favoritesList"></div>
            <div id="favoritesEmpty"></div>
            <div id="activeFilters"></div>
        `;

        const mod = await import('./favorites.js');
        fillFromFavorite = mod.fillFromFavorite;
        addFavorite = mod.addFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('应填充 baseQuery 到搜索输入框', () => {
        addFavorite('title="admin"', { key: { filter: 'country', value: 'CN' } }, 'title="admin" && country="CN"');
        const favorites = getFavorites();

        fillFromFavorite(favorites[0]);

        const input = document.getElementById('searchInput');
        expect(input.value).toBe('title="admin"');
    });

    it('填充后应关闭收藏面板', () => {
        // 创建模拟面板
        const panel = document.createElement('div');
        panel.id = 'favoritesPanel';
        panel.classList.add('show');
        document.body.appendChild(panel);

        addFavorite('test', null, 'test');
        const favorites = getFavorites();
        fillFromFavorite(favorites[0]);

        expect(panel.classList.contains('show')).toBe(false);
    });
});

// ==================== 系统内置规则测试 ====================

describe('seedSystemRules', () => {
    let seedSystemRules, getFavorites, state;

    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem('fofa_favorites', '[]');
        localStorage.removeItem('fofa_rules_seeded');

        const configMod = await import('./config.js');
        state = configMod.state;
        state.favorites = [];

        const mod = await import('./favorites.js');
        seedSystemRules = mod.seedSystemRules;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
        localStorage.removeItem('fofa_rules_seeded');
    });

    it('首次加载应填充系统规则', () => {
        seedSystemRules();
        const favs = getFavorites();
        expect(favs.length).toBeGreaterThan(0);
    });

    it('系统规则应有 system: true 标记', () => {
        seedSystemRules();
        const favs = getFavorites();
        expect(favs.every(f => f.system === true)).toBe(true);
    });

    it('第二次调用不应重复填充', () => {
        seedSystemRules();
        const count1 = getFavorites().length;
        seedSystemRules();
        const count2 = getFavorites().length;
        expect(count1).toBe(count2);
    });
});

describe('removeFavorite with system rules', () => {
    let seedSystemRules, removeFavorite, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem('fofa_favorites', '[]');
        localStorage.removeItem('fofa_rules_seeded');

        const configMod = await import('./config.js');
        configMod.state.favorites = [];

        const mod = await import('./favorites.js');
        seedSystemRules = mod.seedSystemRules;
        removeFavorite = mod.removeFavorite;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
        localStorage.removeItem('fofa_rules_seeded');
    });

    it('不应删除系统规则', () => {
        seedSystemRules();
        const favs = getFavorites();
        const sysQuery = favs[0].baseQuery;

        removeFavorite(sysQuery);
        expect(getFavorites().length).toBe(favs.length);
    });

    it('应能删除用户添加的收藏', async () => {
        seedSystemRules();
        const sysCount = getFavorites().length;

        // 手动添加一条用户收藏
        const { addFavorite } = await import('./favorites.js');
        addFavorite('user_test', null, 'user_test');

        removeFavorite('user_test');
        expect(getFavorites().length).toBe(sysCount);
    });
});

describe('clearAllFavorites with system rules', () => {
    let seedSystemRules, clearAllFavorites, getFavorites;

    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem('fofa_favorites', '[]');
        localStorage.removeItem('fofa_rules_seeded');

        const configMod = await import('./config.js');
        configMod.state.favorites = [];

        const mod = await import('./favorites.js');
        seedSystemRules = mod.seedSystemRules;
        clearAllFavorites = mod.clearAllFavorites;
        getFavorites = mod.getFavorites;
    });

    afterEach(() => {
        localStorage.clear();
        localStorage.removeItem('fofa_rules_seeded');
    });

    it('清除全部时应保留系统规则', async () => {
        seedSystemRules();
        const sysCount = getFavorites().length;

        const { addFavorite } = await import('./favorites.js');
        addFavorite('user_a', null, 'user_a');
        addFavorite('user_b', null, 'user_b');

        clearAllFavorites();
        expect(getFavorites().length).toBe(sysCount);
    });

    it('仅有系统规则时清除全部不应报错', () => {
        seedSystemRules();
        expect(() => clearAllFavorites()).not.toThrow();
    });
});

describe('renderFavoritesList with system rules', () => {
    let seedSystemRules, renderFavoritesList;

    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem('fofa_favorites', '[]');
        localStorage.removeItem('fofa_rules_seeded');
        document.body.innerHTML = `
            <div id="favoritesList"></div>
            <div id="favoritesEmpty"></div>
        `;

        const configMod = await import('./config.js');
        configMod.state.favorites = [];

        const mod = await import('./favorites.js');
        seedSystemRules = mod.seedSystemRules;
        renderFavoritesList = mod.renderFavoritesList;
    });

    afterEach(() => {
        localStorage.clear();
        localStorage.removeItem('fofa_rules_seeded');
    });

    it('系统规则不应显示删除按钮', () => {
        seedSystemRules();
        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        const deleteBtns = list.querySelectorAll('.fav-delete');
        expect(deleteBtns.length).toBe(0);
    });

    it('系统规则应显示内置标记', () => {
        seedSystemRules();
        renderFavoritesList();

        const list = document.getElementById('favoritesList');
        expect(list.innerHTML).toContain('fav-system-badge');
    });
});
