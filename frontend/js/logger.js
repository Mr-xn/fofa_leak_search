// js/logger.js - 本地诊断日志

const LOGGING_ENABLED_KEY = 'fofa_logging_enabled';
const LOGGING_LEVEL_KEY = 'fofa_logging_level';
const LOGS_KEY = 'fofa_logs';
const MAX_LOGS = 500;

export const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

function normalizeLevel(level) {
    return Object.prototype.hasOwnProperty.call(LOG_LEVELS, level) ? level : 'info';
}

export function isLoggingEnabled() {
    return localStorage.getItem(LOGGING_ENABLED_KEY) === 'true';
}

export function setLoggingEnabled(enabled) {
    localStorage.setItem(LOGGING_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getLogLevel() {
    return normalizeLevel(localStorage.getItem(LOGGING_LEVEL_KEY) || 'info');
}

export function setLogLevel(level) {
    localStorage.setItem(LOGGING_LEVEL_KEY, normalizeLevel(level));
}

export function getLogs() {
    try {
        const parsed = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistLogs(logs) {
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(-MAX_LOGS)));
}

export function clearLogs() {
    localStorage.setItem(LOGS_KEY, '[]');
}

export function exportLogs() {
    return JSON.stringify({
        exportTime: new Date().toISOString(),
        logs: getLogs()
    }, null, 2);
}

export function redactSensitiveUrl(url) {
    if (!url || typeof url !== 'string') return url;
    return url.replace(/([?&](?:key|api_key|token|password|pass)=)[^&]*/gi, '$1***');
}

function sanitizeDetails(level, details) {
    if (!details || typeof details !== 'object') return details ?? null;
    const out = Array.isArray(details) ? [...details] : { ...details };
    if (level !== 'debug') {
        for (const key of Object.keys(out)) {
            const lower = key.toLowerCase();
            if (lower.includes('password') || lower === 'pass' || lower.includes('token') || lower === 'key' || lower === 'apikey' || lower === 'api_key') {
                out[key] = '***';
            }
            if (lower.includes('url') && typeof out[key] === 'string') {
                out[key] = redactSensitiveUrl(out[key]);
            }
        }
    }
    return out;
}

export function log(level, module, message, details = null) {
    const normalized = normalizeLevel(level);
    if (!isLoggingEnabled()) return null;
    if (LOG_LEVELS[normalized] > LOG_LEVELS[getLogLevel()]) return null;

    const entry = {
        time: new Date().toISOString(),
        level: normalized,
        module: module || 'app',
        message: String(message || ''),
        details: sanitizeDetails(normalized, details)
    };
    const logs = getLogs();
    logs.push(entry);
    persistLogs(logs);
    return entry;
}

export const debug = (module, message, details) => log('debug', module, message, details);
export const info = (module, message, details) => log('info', module, message, details);
export const warn = (module, message, details) => log('warn', module, message, details);
export const error = (module, message, details) => log('error', module, message, details);
