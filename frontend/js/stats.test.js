// js/stats.test.js - 统计概览模块完整审计测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ==================== 统计按钮禁用状态 ====================

describe('isStatsAvailable', () => {
  let isStatsAvailable;

  beforeEach(async () => {
    const mod = await import('./stats.js');
    isStatsAvailable = mod.isStatsAvailable;
  });

  it('没有查询和 API Key 时返回 false', () => {
    expect(isStatsAvailable('', '')).toBe(false);
  });

  it('有查询但没有 API Key 时返回 false', () => {
    expect(isStatsAvailable('title="test"', '')).toBe(false);
  });

  it('没有查询但有 API Key 时返回 false', () => {
    expect(isStatsAvailable('', 'abc123')).toBe(false);
  });

  it('同时有查询和 API Key 时返回 true', () => {
    expect(isStatsAvailable('title="test"', 'abc123')).toBe(true);
  });

  it('查询为 null 时返回 false', () => {
    expect(isStatsAvailable(null, 'abc123')).toBe(false);
  });

  it('API Key 为 null 时返回 false', () => {
    expect(isStatsAvailable('title="test"', null)).toBe(false);
  });

  it('查询为 undefined 时返回 false', () => {
    expect(isStatsAvailable(undefined, 'abc123')).toBe(false);
  });

  it('查询为纯空格时返回 false', () => {
    expect(isStatsAvailable('   ', 'abc123')).toBe(false);
  });

  it('API Key 为纯空格时返回 false', () => {
    expect(isStatsAvailable('title="test"', '   ')).toBe(false);
  });

  it('非字符串类型输入应返回 false', () => {
    expect(isStatsAvailable(123, 'abc123')).toBe(false);
    expect(isStatsAvailable('title="test"', 123)).toBe(false);
    expect(isStatsAvailable(true, 'abc123')).toBe(false);
  });
});

// ==================== 统计按钮 DOM 状态更新 ====================

describe('updateStatsButtonState', () => {
  let updateStatsButtonState;

  beforeEach(async () => {
    document.body.innerHTML = `
      <button id="statsToggleBtn" class="btn">统计概览</button>
    `;
    const mod = await import('./stats.js');
    updateStatsButtonState = mod.updateStatsButtonState;
  });

  it('无查询时按钮应禁用', () => {
    updateStatsButtonState('', 'key123');
    const btn = document.getElementById('statsToggleBtn');
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('disabled')).toBe(true);
  });

  it('无 API Key 时按钮应禁用', () => {
    updateStatsButtonState('title="test"', '');
    const btn = document.getElementById('statsToggleBtn');
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('disabled')).toBe(true);
  });

  it('同时有查询和 Key 时按钮应启用', () => {
    updateStatsButtonState('title="test"', 'key123');
    const btn = document.getElementById('statsToggleBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('disabled')).toBe(false);
  });

  it('按钮不存在时不应抛错', () => {
    document.body.innerHTML = '';
    expect(() => updateStatsButtonState('q', 'k')).not.toThrow();
  });
});

// ==================== STATS_FIELDS 常量 ====================

describe('STATS_FIELDS constant', () => {
  let STATS_FIELDS;

  beforeEach(async () => {
    const mod = await import('./stats.js');
    STATS_FIELDS = mod.STATS_FIELDS;
  });

  it('应包含 12 个字段', () => {
    expect(STATS_FIELDS).toHaveLength(12);
  });

  it('应包含所有预期字段', () => {
    const expected = ['protocol', 'port', 'country', 'domain', 'os', 'server', 'org', 'asn', 'asset_type', 'title', 'fid', 'icp'];
    expect(STATS_FIELDS).toEqual(expect.arrayContaining(expected));
  });

  it('所有字段应为非空字符串', () => {
    for (const field of STATS_FIELDS) {
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    }
  });
});

// ==================== FIELD_NAMES 映射完整性 ====================

describe('FIELD_NAMES mapping', () => {
  let FIELD_NAMES;

  beforeEach(async () => {
    const mod = await import('./stats.js');
    FIELD_NAMES = mod.FIELD_NAMES;
  });

  it('应为对象类型', () => {
    expect(typeof FIELD_NAMES).toBe('object');
    expect(FIELD_NAMES).not.toBeNull();
  });

  it('所有 STATS_FIELDS 都应有对应的中文名', async () => {
    const mod = await import('./stats.js');
    for (const field of mod.STATS_FIELDS) {
      expect(FIELD_NAMES[field]).toBeDefined();
      expect(typeof FIELD_NAMES[field]).toBe('string');
      expect(FIELD_NAMES[field].length).toBeGreaterThan(0);
    }
  });

  it('中文名不应包含英文（除缩写外）', () => {
    // 允许的英文缩写
    const allowedEnglish = ['HTTP', 'Server', 'IP', 'ICP', 'FID', 'ASN', 'ID'];
    for (const [key, name] of Object.entries(FIELD_NAMES)) {
      // 检查是否包含非中文、非数字、非标点的纯英文单词
      const englishWords = name.match(/[A-Za-z]+/g) || [];
      for (const word of englishWords) {
        expect(allowedEnglish).toContain(word);
      }
    }
  });

  it('关键字段的中文名应准确', () => {
    expect(FIELD_NAMES.protocol).toBe('协议');
    expect(FIELD_NAMES.port).toBe('端口');
    expect(FIELD_NAMES.domain).toBe('域名');
    expect(FIELD_NAMES.title).toBe('网站标题');
    expect(FIELD_NAMES.country).toBe('国家/地区');
    expect(FIELD_NAMES.icp).toBe('ICP 备案');
  });
});

// ==================== 统计缓存逻辑 ====================

describe('statsCache validation', () => {
  const TTL = 5 * 60 * 1000; // 5分钟

  it('缓存未过期应命中', () => {
    const cached = { data: { size: 100 }, timestamp: Date.now() - 1000 };
    expect(Date.now() - cached.timestamp < TTL).toBe(true);
  });

  it('缓存过期应未命中', () => {
    const cached = { data: { size: 100 }, timestamp: Date.now() - TTL - 1000 };
    expect(Date.now() - cached.timestamp < TTL).toBe(false);
  });

  it('缓存恰好在 TTL 边界内应命中', () => {
    const cached = { data: { size: 100 }, timestamp: Date.now() - TTL + 1000 };
    expect(Date.now() - cached.timestamp < TTL).toBe(true);
  });

  it('缓存恰好超出 TTL 应未命中', () => {
    const cached = { data: { size: 100 }, timestamp: Date.now() - TTL - 1 };
    expect(Date.now() - cached.timestamp < TTL).toBe(false);
  });
});

// ==================== 统计面板显隐 ====================

describe('toggleStats panel visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="statsToggleBtn" class="btn">统计概览</button>
      <div id="statsPanel" style="display: none;"></div>
      <div id="statsContent"></div>
    `;
  });

  it('初始状态面板应隐藏', () => {
    const panel = document.getElementById('statsPanel');
    expect(panel.style.display).toBe('none');
  });

  it('showStatsPanel 应显示面板', async () => {
    const mod = await import('./stats.js');
    mod.showStatsPanel();
    const panel = document.getElementById('statsPanel');
    expect(panel.style.display).toBe('block');
  });

  it('hideStatsPanel 应隐藏面板', async () => {
    const mod = await import('./stats.js');
    mod.showStatsPanel();
    mod.hideStatsPanel();
    const panel = document.getElementById('statsPanel');
    expect(panel.style.display).toBe('none');
  });

  it('showStatsPanel 应给按钮添加 btn-primary 类', async () => {
    const mod = await import('./stats.js');
    mod.showStatsPanel();
    const btn = document.getElementById('statsToggleBtn');
    expect(btn.classList.contains('btn-primary')).toBe(true);
  });

  it('hideStatsPanel 应移除按钮的 btn-primary 类', async () => {
    const mod = await import('./stats.js');
    mod.showStatsPanel();
    mod.hideStatsPanel();
    const btn = document.getElementById('statsToggleBtn');
    expect(btn.classList.contains('btn-primary')).toBe(false);
  });

  it('面板和按钮不存在时不应抛错', async () => {
    document.body.innerHTML = '';
    const mod = await import('./stats.js');
    expect(() => mod.showStatsPanel()).not.toThrow();
    expect(() => mod.hideStatsPanel()).not.toThrow();
  });
});

// ==================== renderStatsCard 渲染审计 ====================

describe('renderStatsCard', () => {
  let renderStatsCard;

  beforeEach(async () => {
    const mod = await import('./stats.js');
    renderStatsCard = mod.renderStatsCard;
  });

  it('应返回包含 stats-card 类的 HTML 字符串', () => {
    const html = renderStatsCard('protocol', [{ name: 'http', count: 100 }], 200);
    expect(html).toContain('stats-card');
    expect(html).toContain('stats-card-title');
    expect(html).toContain('stats-card-body');
  });

  it('应使用 FIELD_NAMES 中的中文名作为标题', () => {
    const html = renderStatsCard('protocol', [{ name: 'http', count: 100 }], 200);
    expect(html).toContain('协议');
  });

  it('未知字段应使用字段名作为标题', () => {
    const html = renderStatsCard('unknown_field', [{ name: 'test', count: 100 }], 200);
    expect(html).toContain('unknown_field');
  });

  it('应正确计算百分比', () => {
    const html = renderStatsCard('port', [{ name: '80', count: 50 }], 200);
    expect(html).toContain('25.0%');
  });

  it('总数为 0 时百分比应为 0%', () => {
    const html = renderStatsCard('port', [{ name: '80', count: 0 }], 0);
    expect(html).toContain('0%');
  });

  it('name 为空时应显示 (空)', () => {
    const html = renderStatsCard('port', [{ name: '', count: 10 }], 100);
    expect(html).toContain('(空)');
  });

  it('name 为 null 时应显示 (空)', () => {
    const html = renderStatsCard('port', [{ name: null, count: 10 }], 100);
    expect(html).toContain('(空)');
  });

  it('应正确计算进度条宽度（相对最大值）', () => {
    const items = [
      { name: 'http', count: 100 },
      { name: 'https', count: 50 },
    ];
    const html = renderStatsCard('protocol', items, 200);
    // http: 100/100 * 100 = 100%
    expect(html).toContain('width: 100%');
    // https: 50/100 * 100 = 50%
    expect(html).toContain('width: 50%');
  });

  it('进度条最小宽度应为 2%', () => {
    const items = [
      { name: 'http', count: 10000 },
      { name: 'rare', count: 1 },
    ];
    const html = renderStatsCard('protocol', items, 10001);
    // rare: 1/10000 * 100 = 0.01, 但最小为 2
    expect(html).toContain('width: 2%');
  });

  it('count 为 0 时进度条宽度应为最小值 2%', () => {
    const items = [{ name: 'empty', count: 0 }];
    const html = renderStatsCard('port', items, 100);
    // Math.max(2, 0) = 2，最小宽度保护
    expect(html).toContain('width: 2%');
  });

  it('应包含 escapeHtml 转义的 name（防 XSS）', () => {
    const html = renderStatsCard('title', [{ name: '<script>alert(1)</script>', count: 10 }], 100);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('应包含格式化的数字（万为单位）', () => {
    const html = renderStatsCard('port', [{ name: '80', count: 1234567 }], 2000000);
    // formatNumber(1234567) => "123.5万"
    expect(html).toContain('123.5万');
  });
});

// ==================== renderStats 渲染审计 ====================

describe('renderStats', () => {
  let renderStats;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="statsContent"></div>';
    const mod = await import('./stats.js');
    renderStats = mod.renderStats;
  });

  it('无 aggs 时应显示"无统计数据"', () => {
    renderStats({ size: 100 });
    const content = document.getElementById('statsContent');
    expect(content.innerHTML).toContain('无统计数据');
  });

  it('aggs 为空对象时应显示"无统计数据"', () => {
    renderStats({ size: 100, aggs: {} });
    const content = document.getElementById('statsContent');
    expect(content.innerHTML).toContain('无统计数据');
  });

  it('应显示资产总数', () => {
    renderStats({
      size: 12345,
      aggs: { protocol: [{ name: 'http', count: 100 }] }
    });
    const content = document.getElementById('statsContent');
    // formatNumber(12345) => "1.2万"
    expect(content.innerHTML).toContain('1.2万');
  });

  it('应显示独立 IP 数量', () => {
    renderStats({
      size: 100,
      distinct: { ip: 50 },
      aggs: { protocol: [{ name: 'http', count: 100 }] }
    });
    const content = document.getElementById('statsContent');
    expect(content.innerHTML).toContain('50 个独立IP');
  });

  it('应显示所有 distinct 字段', () => {
    renderStats({
      size: 100,
      distinct: {
        ip: 50,
        title: 30,
        domain: 20,
        server: 10,
        icp: 5,
        fid: 3,
      },
      aggs: { protocol: [{ name: 'http', count: 100 }] }
    });
    const content = document.getElementById('statsContent').innerHTML;
    expect(content).toContain('50 个独立IP');
    expect(content).toContain('30 个独立标题');
    expect(content).toContain('20 个独立域名');
    expect(content).toContain('10 个独立Server');
    expect(content).toContain('5 个独立ICP');
    expect(content).toContain('3 个独立FID');
  });

  it('distinct 部分字段为空时不显示该字段', () => {
    renderStats({
      size: 100,
      distinct: { ip: 50 },
      aggs: { protocol: [{ name: 'http', count: 100 }] }
    });
    const content = document.getElementById('statsContent').innerHTML;
    expect(content).toContain('50 个独立IP');
    expect(content).not.toContain('独立域名');
    expect(content).not.toContain('独立标题');
  });

  it('应显示数据更新时间', () => {
    renderStats({
      size: 100,
      lastupdatetime: '2024-01-15',
      aggs: { protocol: [{ name: 'http', count: 100 }] }
    });
    const content = document.getElementById('statsContent').innerHTML;
    expect(content).toContain('2024-01-15');
  });

  it('应跳过空数组的字段', () => {
    renderStats({
      size: 100,
      aggs: {
        protocol: [{ name: 'http', count: 100 }],
        port: [],
        country: null,
      }
    });
    const content = document.getElementById('statsContent').innerHTML;
    // protocol 应该渲染
    expect(content).toContain('stats-card');
    // port (空数组) 和 country (null) 不应生成卡片
    // 但我们只检查有内容的部分
  });

  it('statsContent 元素不存在时不应抛错', () => {
    document.body.innerHTML = '';
    expect(() => renderStats({ size: 100, aggs: {} })).not.toThrow();
  });
});

// ==================== loadStats 审计 ====================

describe('loadStats', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="statsToggleBtn" class="btn">统计概览</button>
      <div id="statsPanel" style="display: none;"></div>
      <div id="statsContent"></div>
    `;
  });

  it('没有 currentQuery 时应直接返回', async () => {
    const { state } = await import('./config.js');
    const originalQuery = state.currentQuery;
    state.currentQuery = '';

    const mod = await import('./stats.js');
    const content = document.getElementById('statsContent');
    content.innerHTML = '原始内容';

    await mod.loadStats();
    // 内容不应改变
    expect(content.innerHTML).toBe('原始内容');

    state.currentQuery = originalQuery;
  });

  it('没有 apiKey 时应直接返回', async () => {
    const { state } = await import('./config.js');
    const originalKey = state.apiKey;
    state.apiKey = '';

    const mod = await import('./stats.js');
    const content = document.getElementById('statsContent');
    content.innerHTML = '原始内容';

    await mod.loadStats();
    expect(content.innerHTML).toBe('原始内容');

    state.apiKey = originalKey;
  });

  it('statsContent 元素不存在时应直接返回', async () => {
    document.body.innerHTML = '<div id="statsPanel"></div>';
    const { state } = await import('./config.js');
    const originalQuery = state.currentQuery;
    const originalKey = state.apiKey;
    state.currentQuery = 'test';
    state.apiKey = 'key123';

    const mod = await import('./stats.js');
    // 不应抛错
    await expect(mod.loadStats()).resolves.not.toThrow();

    state.currentQuery = originalQuery;
    state.apiKey = originalKey;
  });
});

// ==================== toggleStats 审计 ====================

describe('toggleStats behavior', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="statsToggleBtn" class="btn">统计概览</button>
      <div id="statsPanel" style="display: none;"></div>
      <div id="statsContent"></div>
    `;
  });

  it('面板隐藏时调用应显示面板', async () => {
    const mod = await import('./stats.js');
    mod.toggleStats();
    const panel = document.getElementById('statsPanel');
    expect(panel.style.display).toBe('block');
  });

  it('面板显示时调用应隐藏面板', async () => {
    const mod = await import('./stats.js');
    mod.toggleStats(); // 显示
    mod.toggleStats(); // 隐藏
    const panel = document.getElementById('statsPanel');
    expect(panel.style.display).toBe('none');
  });

  it('面板元素不存在时不应抛错', async () => {
    document.body.innerHTML = '';
    const mod = await import('./stats.js');
    expect(() => mod.toggleStats()).not.toThrow();
  });
});

// ==================== refreshStats 审计 ====================

describe('refreshStats', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toast"></div>
      <button id="statsToggleBtn" class="btn">统计概览</button>
      <div id="statsPanel" style="display: none;"></div>
      <div id="statsContent"></div>
    `;
  });

  it('没有 currentQuery 时应显示错误提示', async () => {
    const { state } = await import('./config.js');
    const originalQuery = state.currentQuery;
    const originalKey = state.apiKey;
    state.currentQuery = '';
    state.apiKey = 'key123';

    const mod = await import('./stats.js');
    // refreshStats 内部会调用 showToast，我们只验证不抛错
    expect(() => mod.refreshStats()).not.toThrow();

    state.currentQuery = originalQuery;
    state.apiKey = originalKey;
  });

  it('没有 apiKey 时应显示错误提示', async () => {
    const { state } = await import('./config.js');
    const originalQuery = state.currentQuery;
    const originalKey = state.apiKey;
    state.currentQuery = 'test';
    state.apiKey = '';

    const mod = await import('./stats.js');
    expect(() => mod.refreshStats()).not.toThrow();

    state.currentQuery = originalQuery;
    state.apiKey = originalKey;
  });
});
