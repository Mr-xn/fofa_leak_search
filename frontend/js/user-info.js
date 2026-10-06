// js/user-info.js - 用户信息展示

import { state, VIP_LEVEL_MAP, STORAGE_KEYS } from './config.js';
import { showToast } from './utils.js';
import { getCachedUserInfo, setCachedUserInfo } from './storage.js';
import { fetchAccountInfo } from './api.js';
import { showApiKeyModal } from './ui.js';
import { t } from './i18n/index.js';

// ==================== 渲染用户信息 ====================
function renderUserInfo(user) {
    const content = document.getElementById('userInfoContent');
    const vipLevelName = user.isvip
        ? (VIP_LEVEL_MAP[user.vip_level] ? t(VIP_LEVEL_MAP[user.vip_level]) : `VIP ${user.vip_level}`)
        : t('免费用户');
    const expiration = user.expiration || t('终身');

    content.innerHTML = `
        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
            <div style="flex: 1; text-align: center; padding: 20px 0; background: linear-gradient(135deg, var(--primary), #7c3aed); border-radius: 12px; color: white;">
                <div style="font-size: 32px; font-weight: 700;">${(user.fofa_point || 0).toLocaleString()}</div>
                <div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">${t('F 点')}</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 20px 0; background: linear-gradient(135deg, #f59e0b, #f97316); border-radius: 12px; color: white;">
                <div style="font-size: 32px; font-weight: 700;">${(user.fcoin || 0).toLocaleString()}</div>
                <div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">${t('F 币')}</div>
            </div>
        </div>

        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
            <div style="flex: 1; text-align: center; padding: 14px; background: var(--bg); border-radius: 10px;">
                <div style="font-size: 18px; font-weight: 700; color: var(--primary);">${user.remain_free_point || 0}</div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${t('剩余免费 F 点')}</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 14px; background: var(--bg); border-radius: 10px;">
                <div style="font-size: 18px; font-weight: 700; color: var(--warning);">${user.remain_api_query === -1 ? t('不限') : (user.remain_api_query || '-')}</div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${t('API 查询次数')}</div>
            </div>
            <div style="flex: 1; text-align: center; padding: 14px; background: var(--bg); border-radius: 10px;">
                <div style="font-size: 18px; font-weight: 700; color: var(--success);">${user.remain_api_data === -1 ? t('不限') : (user.remain_api_data || '-')}</div>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${t('API 数据配额')}</div>
            </div>
        </div>

        <div class="info-item">
            <span class="info-label">${t('👤 用户名')}</span>
            <span class="info-value">${user.username || '-'}</span>
        </div>
        <div class="info-item">
            <span class="info-label">${t('📧 邮箱')}</span>
            <span class="info-value" style="font-size: 14px;">${user.email || '-'}</span>
        </div>
        <div class="info-item">
            <span class="info-label">${t('🏷️ 身份权限')}</span>
            <span class="info-value">
                <span class="badge ${user.isvip ? 'badge-vip' : 'badge-free'}">
                    ${vipLevelName}
                </span>
            </span>
        </div>
        <div class="info-item">
            <span class="info-label">${t('⏰ 有效期止')}</span>
            <span class="info-value" style="font-size: 14px;">${expiration}</span>
        </div>
        <div class="info-item">
            <span class="info-label">${t('📊 API 数据配额')}</span>
            <span class="info-value primary">${user.remain_api_data === -1 ? t('不限') : (user.remain_api_data || '-')}</span>
        </div>
        <div class="info-item">
            <span class="info-label">🔑 API Key</span>
            <span class="info-value" style="font-size: 11px; font-family: monospace; word-break: break-all;">${state.apiKey.substring(0, 16)}...${state.apiKey.substring(state.apiKey.length - 8)}</span>
        </div>

        <div style="margin-top: 24px; padding: 16px; background: var(--bg); border-radius: 10px;">
            <p style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 12px;">${t('📋 查询配额说明')}</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; color: var(--text-secondary);">
                <div>${t('• 免费用户: 100 条/次')}</div>
                <div>${t('• 个人版: 1,000 条/次')}</div>
                <div>${t('• 高级会员: 10,000 条/次')}</div>
                <div>${t('• 企业版: 不限')}</div>
            </div>
        </div>

        <div style="margin-top: 16px; padding: 16px; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border-radius: 10px; border: 1px solid #bae6fd;">
            <p style="font-size: 13px; font-weight: 600; color: #0369a1; margin-bottom: 12px;">${t('💡 F点与F币说明')}</p>
            <div style="font-size: 12px; color: #0c4a6e; line-height: 1.8;">
                <div>${t('<strong>F点</strong>：FOFA 的虚拟货币，可用于查询和下载数据')}</div>
                <div>${t('• 免费额度用尽后可使用 F点 继续查询和导出数据')}</div>
                <div>${t('• F点 有效期为购买日起一年，过期自动失效')}</div>
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #bae6fd;">
                    ${t('<strong>增值权益</strong>：非当前等级可用的语法/功能可通过 F点 使用，可在个人中心随时取消')}
                </div>
                <div>${t('• F点增值权益 24 小时使用超过 10 次时，24 小时内不再扣除 F点')}</div>
                <div>${t('• API 每日超限，1 F点 = 1 条数据')}</div>
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #bae6fd;">
                    ${t('<strong>F币</strong>：1 F币 可兑换 10,000 F点，最多可兑换 50 个 F币')}
                </div>
            </div>
        </div>

        <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center;">
            <button class="btn btn-secondary btn-small" onclick="window.refreshUserInfo()">${t('🔄 刷新数据')}</button>
            <button class="btn btn-secondary btn-small" onclick="window.openUrl('https://fofa.info/userInfo')">${t('前往 FOFA 个人中心 →')}</button>
        </div>
    `;
}

// ==================== 刷新用户信息 ====================
export async function refreshUserInfo() {
    const btn = document.querySelector('[onclick="window.refreshUserInfo()"]');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = t('⏳ 刷新中...');
    btn.style.opacity = '0.6';

    try {
        const data = await fetchAccountInfo();

        if (data.error) {
            showToast(t('刷新失败: {{message}}', { message: data.errmsg || t('接口返回错误') }), 'error');
            return;
        }

        // 更新缓存和状态
        setCachedUserInfo(data);
        state.userInfo = data;
        renderUserInfo(data);
        showToast(t('账户信息已更新'), 'success');
    } catch (error) {
        let msg = t('网络异常');
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            msg = t('网络连接失败，请检查网络');
        } else if (error.message.includes('timeout')) {
            msg = t('请求超时，请稍后重试');
        } else if (error.message) {
            msg = error.message;
        }
        showToast(t('刷新失败: {{message}}', { message: msg }), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.style.opacity = '1';
    }
}

// ==================== 显示用户信息面板 ====================
export async function showUserInfo(forceRefresh = false) {
    if (!state.apiKey) {
        showApiKeyModal();
        return;
    }

    const panel = document.getElementById('userInfoPanel');
    const content = document.getElementById('userInfoContent');

    panel.classList.add('show');

    // 尝试从缓存获取
    if (!forceRefresh) {
        const cachedData = getCachedUserInfo();
        if (cachedData) {
            renderUserInfo(cachedData);
            return;
        }
    }

    // 显示加载状态
    content.innerHTML = `<div style="text-align: center; padding: 40px 0;"><div class="spinner" style="margin: 0 auto;"></div><p style="color: var(--text-secondary); margin-top: 12px;">${t('正在获取账户信息...')}</p></div>`;

    try {
        const data = await fetchAccountInfo();

        if (data.error) {
            content.innerHTML = `<div style="text-align: center; padding: 40px 0; color: var(--error);"><p>${t('获取失败: {{message}}', { message: data.errmsg })}</p></div>`;
            return;
        }

        setCachedUserInfo(data);
        state.userInfo = data;  // 同步更新 state
        renderUserInfo(data);
    } catch (error) {
        content.innerHTML = `<div style="text-align: center; padding: 40px 0; color: var(--error);"><p>${t('网络错误: {{message}}', { message: error.message })}</p></div>`;
    }
}
