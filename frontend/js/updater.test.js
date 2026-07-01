// js/updater.test.js - 在线更新检测测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ==================== 版本解析与比较 ====================

describe('parseVersion', () => {
    let parseVersion;

    beforeEach(async () => {
        const mod = await import('./updater.js');
        parseVersion = mod.parseVersion;
    });

    it('应正确解析标准三段的版本号', () => {
        expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    });

    it('应正确解析两段的版本号', () => {
        expect(parseVersion('1.2')).toEqual([1, 2]);
    });

    it('应正确解析带 v 前缀的版本号', () => {
        expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    });

    it('应正确解析带 V 大写前缀的版本号', () => {
        expect(parseVersion('V2.0.0')).toEqual([2, 0, 0]);
    });

    it('应处理单段版本号', () => {
        expect(parseVersion('1')).toEqual([1]);
    });

    it('空字符串应返回空数组', () => {
        expect(parseVersion('')).toEqual([]);
    });

    it('null 应返回空数组', () => {
        expect(parseVersion(null)).toEqual([]);
    });

    it('undefined 应返回空数组', () => {
        expect(parseVersion(undefined)).toEqual([]);
    });

    it('非字符串应返回空数组', () => {
        expect(parseVersion(123)).toEqual([]);
    });

    it('非数字段应过滤掉', () => {
        expect(parseVersion('1.abc.3')).toEqual([1, 3]);
    });
});

describe('compareVersions', () => {
    let compareVersions;

    beforeEach(async () => {
        const mod = await import('./updater.js');
        compareVersions = mod.compareVersions;
    });

    it('相等版本应返回 0', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });

    it('左边大应返回 1', () => {
        expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    });

    it('左边小应返回 -1', () => {
        expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });

    it('同主版本号，次版本号大的应更大', () => {
        expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    });

    it('同主次版本号，修订号大的应更大', () => {
        expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    });

    it('v 前缀不应影响比较结果', () => {
        expect(compareVersions('v2.0.0', '1.9.9')).toBe(1);
    });

    it('两位和三位比较应正确（缺失位视为 0）', () => {
        expect(compareVersions('1.3', '1.3.0')).toBe(0);
        expect(compareVersions('1.3.1', '1.3')).toBe(1);
    });

    it('大版本号跳跃应正确识别', () => {
        expect(compareVersions('10.0.0', '2.3.4')).toBe(1);
    });

    it('纯数字比较避免字符串排序问题', () => {
        expect(compareVersions('9.0.0', '10.0.0')).toBe(-1);
    });
});

describe('isNewerVersion', () => {
    let isNewerVersion;

    beforeEach(async () => {
        const mod = await import('./updater.js');
        isNewerVersion = mod.isNewerVersion;
    });

    it('latest > current 应返回 true', () => {
        expect(isNewerVersion('v1.2.0', '1.1.0')).toBe(true);
    });

    it('latest = current 应返回 false', () => {
        expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false);
    });

    it('latest < current 应返回 false', () => {
        expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false);
    });

    it('空 latest 应返回 false', () => {
        expect(isNewerVersion('', '1.1.0')).toBe(false);
    });

    it('空 current 应返回 false', () => {
        expect(isNewerVersion('1.2.0', '')).toBe(false);
    });
});

// ==================== GitHub API 调用 ====================

describe('fetchLatestRelease', () => {
    let fetchLatestRelease;

    beforeEach(async () => {
        global.fetch = vi.fn();
        const mod = await import('./updater.js');
        fetchLatestRelease = mod.fetchLatestRelease;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('应调用正确的 GitHub API URL', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tag_name: 'v2.0.0', html_url: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v2.0.0' })
        });

        await fetchLatestRelease();

        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/Mr-xn/fofa_leak_search/releases/latest',
            expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) })
        );
    });

    it('成功时应返回 tag_name 和 html_url', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tag_name: 'v3.0.0', html_url: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v3.0.0' })
        });

        const result = await fetchLatestRelease();
        expect(result).toEqual({
            version: 'v3.0.0',
            url: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v3.0.0'
        });
    });

    it('API 失败时应返回 null', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await fetchLatestRelease();
        expect(result).toBeNull();
    });

    it('响应非 ok 时应返回 null', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 403
        });

        const result = await fetchLatestRelease();
        expect(result).toBeNull();
    });

    it('响应缺少 tag_name 时应返回 null', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({})
        });

        const result = await fetchLatestRelease();
        expect(result).toBeNull();
    });
});

// ==================== 更新检查主流程 ====================

describe('checkForUpdates', () => {
    let checkForUpdates;

    beforeEach(async () => {
        global.fetch = vi.fn();
        document.body.innerHTML = '<div id="toast"></div>';
        const mod = await import('./updater.js');
        checkForUpdates = mod.checkForUpdates;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('有新版本时应返回更新信息', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v9.9.9' })
        });

        const result = await checkForUpdates();
        expect(result).toEqual({
            hasUpdate: true,
            latestVersion: 'v9.9.9',
            currentVersion: expect.any(String),
            releaseUrl: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v9.9.9'
        });
    });

    it('已是最新版本时应返回 hasUpdate=false', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tag_name: 'v0.0.1', html_url: 'https://github.com/Mr-xn/fofa_leak_search/releases/tag/v0.0.1' })
        });

        const result = await checkForUpdates();
        expect(result.hasUpdate).toBe(false);
    });

    it('API 失败时应返回 hasUpdate=false', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Offline'));

        const result = await checkForUpdates();
        expect(result.hasUpdate).toBe(false);
    });
});

// ==================== 配置持久化 ====================

describe('update settings persistence', () => {
    let STORAGE_KEYS, state;

    beforeEach(async () => {
        localStorage.clear();
        const configMod = await import('./config.js');
        STORAGE_KEYS = configMod.STORAGE_KEYS;
        state = configMod.state;
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('STORAGE_KEYS 应包含 autoCheckUpdate 键', () => {
        expect(STORAGE_KEYS.autoCheckUpdate).toBe('fofa_auto_check_update');
    });

    it('state 应包含 autoCheckUpdate 字段且默认为 true', () => {
        expect(state.autoCheckUpdate).toBe(true);
    });
});
