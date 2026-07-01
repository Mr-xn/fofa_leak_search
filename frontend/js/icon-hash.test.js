// js/icon-hash.test.js - Icon Hash 计算测试 (MurmurHash3 + Base64)

import { describe, it, expect, beforeEach } from 'vitest';

// ==================== Base64 换行 ====================

describe('base64Wrap', () => {
    let base64Wrap;

    beforeEach(async () => {
        const mod = await import('./icon-hash.js');
        base64Wrap = mod.base64Wrap;
    });

    it('空字符串应只返回换行符', () => {
        expect(base64Wrap('')).toBe('\n');
    });

    it('少于76字符应只加末尾换行', () => {
        const input = 'abc123';
        expect(base64Wrap(input)).toBe('abc123\n');
    });

    it('正好76字符应在第76位后插入换行并在末尾加换行', () => {
        const input = 'A'.repeat(76);
        // Go 代码: 第76个字符(index 75)写完后触发 (i+1)%76==0 → 插入\n，循环后末尾再\n
        expect(base64Wrap(input)).toBe('A'.repeat(76) + '\n\n');
    });

    it('超过76字符应在第76位后插入换行并在末尾加换行', () => {
        const input = 'A'.repeat(100);
        const result = base64Wrap(input);
        // 位置0-75是A (76个), 位置76是\n, 位置77-100是A (24个), 最后是\n
        expect(result[76]).toBe('\n');
        expect(result[result.length - 1]).toBe('\n');
        expect(result.replace(/\n/g, '')).toBe('A'.repeat(100));
    });

    it('152字符应有两个中间换行加末尾换行', () => {
        const input = 'B'.repeat(152);
        const result = base64Wrap(input);
        const newlines = (result.match(/\n/g) || []).length;
        expect(newlines).toBe(3); // 位置76, 位置153(76*2+1), 末尾
    });

    it('换行不应改变原字符顺序', () => {
        const input = 'abcdefghij';
        const result = base64Wrap(input);
        expect(result.replace(/\n/g, '')).toBe(input);
    });
});

// ==================== int32 符号转换 ====================

describe('uint32ToInt32', () => {
    let uint32ToInt32;

    beforeEach(async () => {
        const mod = await import('./icon-hash.js');
        uint32ToInt32 = mod.uint32ToInt32;
    });

    it('0 应转为 0', () => {
        expect(uint32ToInt32(0)).toBe(0);
    });

    it('小于 2^31 的正数保持不变', () => {
        expect(uint32ToInt32(42)).toBe(42);
        expect(uint32ToInt32(2147483647)).toBe(2147483647); // max int32
    });

    it('大于等于 2^31 的数应转为负数', () => {
        expect(uint32ToInt32(2147483648)).toBe(-2147483648); // min int32
        expect(uint32ToInt32(4294967295)).toBe(-1); // max uint32 → -1
    });

    it('常见的中间值转换正确', () => {
        expect(uint32ToInt32(3000000000)).toBe(3000000000 - 4294967296);
        expect(uint32ToInt32(4000000000)).toBe(4000000000 - 4294967296);
    });
});

// ==================== MurmurHash3 32-bit ====================

describe('mmh3_32', () => {
    let mmh3_32;

    beforeEach(async () => {
        const mod = await import('./icon-hash.js');
        mmh3_32 = mod.mmh3_32;
    });

    it('应返回数字', () => {
        const result = mmh3_32('hello', 0);
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(4294967296); // < 2^32
    });

    it('空字符串 seed=0 应返回 0', () => {
        expect(mmh3_32('', 0)).toBe(0);
    });

    it('相同输入应返回相同结果（确定性）', () => {
        const a = mmh3_32('test data here', 0);
        const b = mmh3_32('test data here', 0);
        expect(a).toBe(b);
    });

    it('不同输入应返回不同结果', () => {
        const a = mmh3_32('hello', 0);
        const b = mmh3_32('world', 0);
        expect(a).not.toBe(b);
    });

    it('不同 seed 应返回不同结果', () => {
        const a = mmh3_32('hello', 0);
        const b = mmh3_32('hello', 1);
        expect(a).not.toBe(b);
    });

    it('应能处理包含换行符的输入', () => {
        const input = 'abc\n'.repeat(10);
        expect(() => mmh3_32(input, 0)).not.toThrow();
        expect(typeof mmh3_32(input, 0)).toBe('number');
    });

    it('应能处理长输入而不报错', () => {
        const input = 'x'.repeat(10000);
        expect(() => mmh3_32(input, 0)).not.toThrow();
    });

    it('应能处理二进制数据（Uint8Array）', () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);
        expect(() => mmh3_32(data, 0)).not.toThrow();
        expect(typeof mmh3_32(data, 0)).toBe('number');
    });
});

// ==================== 完整流程：computeIconHash ====================

describe('computeIconHash', () => {
    let computeIconHash, base64Wrap;

    beforeEach(async () => {
        const mod = await import('./icon-hash.js');
        computeIconHash = mod.computeIconHash;
        base64Wrap = mod.base64Wrap;
    });

    it('应返回字符串', () => {
        const bytes = new Uint8Array([0x00, 0x01, 0x02]);
        const result = computeIconHash(bytes);
        expect(typeof result).toBe('string');
    });

    it('相同输入应返回相同结果', () => {
        const bytes = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(computeIconHash(bytes)).toBe(computeIconHash(bytes));
    });

    it('结果应可以解析为十进制整数', () => {
        const bytes = new Uint8Array([0x01, 0x02, 0x03]);
        const result = computeIconHash(bytes);
        const parsed = parseInt(result, 10);
        expect(Number.isInteger(parsed)).toBe(true);
    });

    it('1x1 透明 PNG favicon 应产生确定的 hash', () => {
        // 最小 1x1 透明 PNG
        const png = new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
            0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
            0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02,
            0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00,
            0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
            0x60, 0x82
        ]);
        const result = computeIconHash(png);
        expect(typeof result).toBe('string');
        // 确保结果是可重现的
        expect(computeIconHash(png)).toBe(result);
    });

    it('空 Uint8Array 应产生确定的 hash', () => {
        const result = computeIconHash(new Uint8Array([]));
        expect(typeof result).toBe('string');
    });
});
