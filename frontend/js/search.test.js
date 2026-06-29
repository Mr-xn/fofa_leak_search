// js/search.test.js - 搜索按钮禁用状态测试

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ==================== 纯逻辑函数：判断查询是否可提交 ====================
// 这个函数将从 search.js 中提取出来，供 doSearch 和按钮状态更新共用

describe('isSearchSubmittable', () => {
  // 该函数判断输入的查询是否可以提交搜索
  // 规则：查询文本 trim 后必须非空

  let isSearchSubmittable;

  beforeEach(async () => {
    // 动态导入，每次测试前重置模块状态
    const mod = await import('./search.js');
    isSearchSubmittable = mod.isSearchSubmittable;
  });

  it('空字符串应返回 false', () => {
    expect(isSearchSubmittable('')).toBe(false);
  });

  it('纯空格应返回 false', () => {
    expect(isSearchSubmittable('   ')).toBe(false);
  });

  it('有内容应返回 true', () => {
    expect(isSearchSubmittable('title="login"')).toBe(true);
  });

  it('前后有空格但中间有内容应返回 true', () => {
    expect(isSearchSubmittable('  body="admin"  ')).toBe(true);
  });

  it('null 应返回 false', () => {
    expect(isSearchSubmittable(null)).toBe(false);
  });

  it('undefined 应返回 false', () => {
    expect(isSearchSubmittable(undefined)).toBe(false);
  });
});

// ==================== DOM 状态更新函数 ====================

describe('updateSearchButtonState', () => {
  let updateSearchButtonState;

  beforeEach(async () => {
    // 设置 DOM
    document.body.innerHTML = `
      <input type="text" id="searchInput" />
      <button class="btn btn-primary search-btn" id="searchBtn">搜索</button>
    `;

    // 模块导入
    const mod = await import('./search.js');
    updateSearchButtonState = mod.updateSearchButtonState;
  });

  it('输入框为空时按钮应被禁用', () => {
    document.getElementById('searchInput').value = '';
    updateSearchButtonState();
    const btn = document.getElementById('searchBtn') || document.querySelector('.search-btn');
    expect(btn.disabled).toBe(true);
  });

  it('输入框有内容时按钮应启用', () => {
    document.getElementById('searchInput').value = 'title="test"';
    updateSearchButtonState();
    const btn = document.getElementById('searchBtn') || document.querySelector('.search-btn');
    expect(btn.disabled).toBe(false);
  });

  it('输入框只有空格时按钮应被禁用', () => {
    document.getElementById('searchInput').value = '   ';
    updateSearchButtonState();
    const btn = document.getElementById('searchBtn') || document.querySelector('.search-btn');
    expect(btn.disabled).toBe(true);
  });

  it('禁用时按钮应有 disabled 类名（视觉样式）', () => {
    document.getElementById('searchInput').value = '';
    updateSearchButtonState();
    const btn = document.getElementById('searchBtn') || document.querySelector('.search-btn');
    expect(btn.classList.contains('disabled')).toBe(true);
  });

  it('启用时按钮不应有 disabled 类名', () => {
    document.getElementById('searchInput').value = 'test';
    updateSearchButtonState();
    const btn = document.getElementById('searchBtn') || document.querySelector('.search-btn');
    expect(btn.classList.contains('disabled')).toBe(false);
  });
});
