// js/config.js - 配置常量和状态管理

// ==================== 应用版本 ====================
export const APP_VERSION = '1.2.0';

// ==================== 全局状态 ====================
export const state = {
    apiKey: localStorage.getItem('fofa_api_key') || '',
    searchHistory: (() => { try { return JSON.parse(localStorage.getItem('fofa_search_history') || '[]'); } catch { return []; } })(),
    currentPage: 1,
    totalResults: 0,
    results: [],
    sortField: null,
    sortOrder: 'asc',
    currentQuery: '',
    isLoading: false,
    startTime: 0,
    useCache: localStorage.getItem('fofa_use_cache') !== 'false',
    db: null,
    userInfo: null,  // 账户信息，从缓存加载
    apiBaseUrl: '',  // Tauri 模式: 'http://localhost:PORT'，Web 模式: ''（相对路径）
    favorites: (() => { try { return JSON.parse(localStorage.getItem('fofa_favorites') || '[]'); } catch { return []; } })(),
    autoCheckUpdate: localStorage.getItem('fofa_auto_check_update') !== 'false'
};

// ==================== IndexedDB 配置 ====================
export const DB_CONFIG = {
    name: 'FofaSearchDB',
    version: 1,
    storeName: 'queryCache'
};

// ==================== localStorage 键名 ====================
export const STORAGE_KEYS = {
    apiKey: 'fofa_api_key',
    searchHistory: 'fofa_search_history',
    userInfo: 'fofa_user_info',
    useCache: 'fofa_use_cache',
    cacheTimeValue: 'fofa_cache_time_value',
    cacheTimeUnit: 'fofa_cache_time_unit',
    selectedFields: 'fofa_selected_fields',
    pageSize: 'fofa_page_size',
    dataRange: 'fofa_data_range',       // 合并原 timeRange + resultMode
    timeRange: 'fofa_time_range',        // 保留兼容旧配置
    activeFilters: 'fofa_active_filters',
    autoLoadStats: 'fofa_auto_load_stats',  // 搜索时自动加载统计概览
    usage: 'fofa_usage',  // 月度使用统计
    downloadRange: 'fofa_download_range',  // 下载页码范围设置
    exportIncludeQuery: 'fofa_export_include_query',  // 导出 CSV 时包含查询语句
    proxyHost: 'fofa_proxy_host',       // 代理主机
    proxyPort: 'fofa_proxy_port',       // 代理端口
    proxyUsername: 'fofa_proxy_username', // 代理用户名
    proxyPassword: 'fofa_proxy_password', // 代理密码
    userAgent: 'fofa_user_agent',        // 自定义 User-Agent
    customHeaders: 'fofa_custom_headers', // 自定义请求 Headers (JSON)
    favorites: 'fofa_favorites',         // 收藏的查询语句
    autoCheckUpdate: 'fofa_auto_check_update'  // 启动时自动检测更新
};

// ==================== 默认选中字段 ====================
export const DEFAULT_FIELDS = ['ip', 'port', 'host', 'title', 'link'];

// ==================== 快速筛选条件配置 ====================
// 权限等级: 0=免费, 1=个人版, 2=高级会员, 3=专业版, 4=商业版, 5=企业版
export const FILTERS_CONFIG = {
    // 基础类（General）- 输入框类型
    general: [
        { key: 'ip', label: 'IP 地址', type: 'text', placeholder: '如 1.1.1.1 或 1.1.1.1/24', level: 0, operators: ['=', '!=', '*='] },
        { key: 'port', label: '端口', type: 'text', placeholder: '如 80,443', level: 0, operators: ['=', '!='] },
        { key: 'domain', label: '域名', type: 'text', placeholder: '如 qq.com', level: 0, operators: ['=', '!=', '*='] },
        { key: 'host', label: '主机名', type: 'text', placeholder: '如 .fofa.info', level: 0, operators: ['=', '!=', '*='] },
        { key: 'os', label: '操作系统', type: 'text', placeholder: '如 windows,linux', level: 0, operators: ['=', '!=', '*='] },
        { key: 'server', label: '网站服务器', type: 'text', placeholder: '如 nginx,apache', level: 0, operators: ['=', '!=', '*='] },
        { key: 'asn', label: 'ASN 编号', type: 'text', placeholder: '如 19551', level: 0, operators: ['=', '!='] },
        { key: 'org', label: '所属组织', type: 'text', placeholder: '如 Google', level: 0, operators: ['=', '!=', '*='] }
    ],
    // 基础类 - 布尔类型
    generalBool: [
        { key: 'is_domain', label: '域名', trueLabel: '有域名', falseLabel: '无域名', level: 0 },
        { key: 'is_ipv6', label: 'IP 版本', trueLabel: '是 IPv6', falseLabel: '是 IPv4', level: 0 }
    ],
    // 标记类（Special Label）
    labels: [
        { key: 'app', label: '应用', type: 'text', placeholder: '如 Microsoft-Exchange', level: 0, operators: ['=', '!=', '*='] },
        { key: 'product', label: '产品名', type: 'text', placeholder: '如 NGINX', level: 0, operators: ['=', '!=', '*='] },
        { key: 'category', label: '分类', type: 'text', placeholder: '如 服务', level: 1, desc: '个人版+', operators: ['=', '!=', '*='] },
        { key: 'cloud_name', label: '云服务商', type: 'text', placeholder: '如 Aliyundun', level: 0, operators: ['=', '!=', '*='] },
        { key: 'type', label: '资产类型', options: ['subdomain', 'service'], optionLabels: ['网站', '协议'], level: 0 }
    ],
    // 标记类 - 布尔类型
    labelsBool: [
        { key: 'is_cloud', label: '云服务', trueLabel: '是云服务', falseLabel: '非云服务', level: 0 },
        { key: 'is_honeypot', label: '蜜罐', trueLabel: '是蜜罐', falseLabel: '非蜜罐', level: 3, desc: '专业版+' },
        { key: 'is_fraud', label: '仿冒站群', trueLabel: '是仿冒站群', falseLabel: '非仿冒站群', level: 3, desc: '专业版+' }
    ],
    // 协议类（Protocol）
    protocol: [
        { key: 'protocol', label: '协议名', type: 'text', placeholder: '如 http,ssh,quic', level: 0, operators: ['=', '!=', '*='] },
        { key: 'base_protocol', label: '传输协议', options: ['tcp', 'udp'], optionLabels: ['TCP', 'UDP'], level: 0 },
        { key: 'banner', label: '协议 Banner', type: 'text', placeholder: '如 SSH-2.0', level: 0, operators: ['=', '!=', '*='] },
        { key: 'banner_hash', label: 'Banner Hash', type: 'text', placeholder: 'Hash 值', level: 1, desc: '个人版+', operators: ['=', '!='] },
        { key: 'banner_fid', label: 'Banner FID', type: 'text', placeholder: 'FID 值', level: 1, desc: '个人版+', operators: ['=', '!='] }
    ],
    // 网站类（Website）
    website: [
        { key: 'title', label: '网站标题', type: 'text', placeholder: '如 登录,管理后台', level: 0, operators: ['=', '!=', '*='] },
        { key: 'header', label: '响应头', type: 'text', placeholder: '如 elastic', level: 0, operators: ['=', '!=', '*='] },
        { key: 'body', label: '网页正文', type: 'text', placeholder: '如 网络空间测绘', level: 0, operators: ['=', '!=', '*='] },
        { key: 'status_code', label: 'HTTP 状态码', type: 'text', placeholder: '如 200,404', level: 0, operators: ['=', '!='] },
        { key: 'icp', label: 'ICP 备案号', type: 'text', placeholder: '如 京ICP证030173号', level: 0, operators: ['=', '!=', '*='] },
        { key: 'js_name', label: 'JS 文件', type: 'text', placeholder: '如 js/jquery.js', level: 0, operators: ['=', '!=', '*='] },
        { key: 'cname', label: 'CNAME', type: 'text', placeholder: '如 customers.spektrix.com', level: 0, operators: ['=', '!=', '*='] },
        { key: 'icon_hash', label: 'Icon Hash', type: 'text', placeholder: 'Hash 值', level: 0, operators: ['=', '!='] }
    ],
    // 地理位置（Location）
    location: [
        { key: 'country', label: '国家', type: 'text', placeholder: '如 CN,中国', level: 0, operators: ['=', '!=', '*='] },
        { key: 'region', label: '省份/地区', type: 'text', placeholder: '如 Zhejiang,浙江', level: 0, operators: ['=', '!=', '*='] },
        { key: 'city', label: '城市', type: 'text', placeholder: '如 Hangzhou', level: 0, operators: ['=', '!=', '*='] }
    ],
    // 证书类（Certificate）- 布尔类型
    certBool: [
        { key: 'cert.is_valid', label: '证书状态', trueLabel: '有效', falseLabel: '无效', level: 1, desc: '个人版+' },
        { key: 'cert.is_match', label: '证书匹配', trueLabel: '匹配', falseLabel: '不匹配', level: 1, desc: '个人版+' },
        { key: 'cert.is_expired', label: '证书过期', trueLabel: '已过期', falseLabel: '未过期', level: 1, desc: '个人版+' },
        { key: 'cert.is_equal', label: '颁发者=持有者', trueLabel: '相同', falseLabel: '不同', level: 1, desc: '个人版+' }
    ],
    // 证书类 - 输入框类型
    cert: [
        { key: 'cert', label: '证书内容', type: 'text', placeholder: '如 baidu', level: 0, operators: ['=', '!=', '*='] },
        { key: 'cert.subject', label: '证书持有者', type: 'text', placeholder: '如 Oracle Corporation', level: 0, operators: ['=', '!=', '*='] },
        { key: 'cert.issuer', label: '证书颁发者', type: 'text', placeholder: '如 DigiCert', level: 0, operators: ['=', '!=', '*='] },
        { key: 'cert.domain', label: '证书域名', type: 'text', placeholder: '如 huawei.com', level: 0, operators: ['=', '!=', '*='] },
        { key: 'jarm', label: 'JARM 指纹', type: 'text', placeholder: 'JARM 值', level: 0, operators: ['=', '!='] },
        { key: 'tls.version', label: 'TLS 版本', type: 'text', placeholder: '如 TLS 1.3', level: 0, operators: ['=', '!=', '*='] }
    ],
    // 时间类（Time）
    time: [
        { key: 'after', label: '更新时间晚于', type: 'date', placeholder: '', level: 1, desc: '个人版+' },
        { key: 'before', label: '更新时间早于', type: 'date', placeholder: '', level: 1, desc: '个人版+' }
    ],
    // 独立IP类
    ipFilter: [
        { key: 'port_size', label: '开放端口数', type: 'number', placeholder: '如 6', level: 4, desc: '商业版+', operators: ['=', '!='] },
        { key: 'port_size_gt', label: '端口数大于', type: 'number', placeholder: '如 6', level: 4, desc: '商业版+' },
        { key: 'port_size_lt', label: '端口数小于', type: 'number', placeholder: '如 12', level: 4, desc: '商业版+' },
        { key: 'ip_ports', label: '同时开放端口', type: 'text', placeholder: '如 80,443', level: 4, desc: '商业版+', operators: ['=', '!=', '*='] },
        { key: 'ip_country', label: 'IP 国家', type: 'text', placeholder: '如 CN', level: 4, desc: '商业版+', operators: ['=', '!=', '*='] },
        { key: 'ip_region', label: 'IP 省份', type: 'text', placeholder: '如 Zhejiang', level: 4, desc: '商业版+', operators: ['=', '!=', '*='] },
        { key: 'ip_city', label: 'IP 城市', type: 'text', placeholder: '如 Hangzhou', level: 4, desc: '商业版+', operators: ['=', '!=', '*='] },
        { key: 'ip_after', label: 'IP 更新晚于', type: 'date', placeholder: '', level: 4, desc: '商业版+' },
        { key: 'ip_before', label: 'IP 更新早于', type: 'date', placeholder: '', level: 4, desc: '商业版+' }
    ]
};

// ==================== 会员等级映射 ====================
// 来源: https://fofa.info/vip
export const VIP_LEVEL_MAP = {
    0: '注册用户',
    1: '个人版',
    2: '高级会员',  // 已下架，保留兼容
    3: '专业版',
    4: '商业版',
    5: '企业版V2'
};

// ==================== 智能下载配额配置 ====================
// 单次智能下载硬性上限（条数）
export const SMART_DOWNLOAD_HARD_LIMIT = 50000;

// 各等级月度数据获取配额
// key: vip_level, value: 月度最大获取数据量
// 永久高级会员 (level 2) 视为无限制
export const VIP_MONTHLY_DATA_QUOTA = {
    0: 3000,          // 注册用户: 3,000 条/月
    1: 100000,        // 个人版: 100,000 条/月
    2: Infinity,      // 高级会员(永久): 无限制
    3: 800000,        // 专业版: 800,000 条/月
    4: 9000000,       // 商业版: 9,000,000 条/月
    5: 50000000       // 企业版V2: 50,000,000 条/月
};

// ==================== 字段权限配置 ====================
// 权限等级: 0=免费, 1=个人版, 3=专业版, 4=商业版, 5=企业版
export const FIELDS_CONFIG = [
    // 基础字段（免费）
    { field: 'ip', label: 'IP 地址', level: 0 },
    { field: 'port', label: '端口', level: 0 },
    { field: 'protocol', label: '协议名', level: 0 },
    { field: 'country', label: '国家代码', level: 0 },
    { field: 'country_name', label: '国家名', level: 0 },
    { field: 'region', label: '区域', level: 0 },
    { field: 'city', label: '城市', level: 0 },
    { field: 'longitude', label: '经度', level: 0 },
    { field: 'latitude', label: '纬度', level: 0 },
    { field: 'asn', label: 'ASN 编号', level: 0 },
    { field: 'org', label: 'ASN 组织', level: 0 },
    { field: 'host', label: '主机名', level: 0 },
    { field: 'domain', label: '域名', level: 0 },
    { field: 'os', label: '操作系统', level: 0 },
    { field: 'server', label: '网站服务器', level: 0 },
    { field: 'icp', label: 'ICP 备案号', level: 0 },
    { field: 'title', label: '网站标题', level: 0 },
    { field: 'jarm', label: 'JARM 指纹', level: 0 },
    { field: 'header', label: '网站 Header', level: 0 },
    { field: 'banner', label: '协议 Banner', level: 0 },
    { field: 'cert', label: '证书', level: 0 },
    { field: 'base_protocol', label: '基础协议', level: 0 },
    { field: 'link', label: 'URL 链接', level: 0 },
    // 证书字段（免费）- 使用下划线格式匹配实际 API
    { field: 'certs_issuer_org', label: '证书颁发者组织', level: 0 },
    { field: 'certs_issuer_cn', label: '证书颁发者 CN', level: 0 },
    { field: 'certs_subject_org', label: '证书持有者组织', level: 0 },
    { field: 'certs_subject_cn', label: '证书持有者 CN', level: 0 },
    { field: 'tls_ja3s', label: 'JA3S 指纹', level: 0 },
    { field: 'tls_version', label: 'TLS 版本', level: 0 },
    { field: 'certs_sn', label: '证书序列号', level: 0 },
    { field: 'certs_not_before', label: '证书生效时间', level: 0 },
    { field: 'certs_not_after', label: '证书到期时间', level: 0 },
    { field: 'certs_domain', label: '证书根域名', level: 0 },
    { field: 'status_code', label: 'HTTP 状态码', level: 0 },
    // 个人版及以上
    { field: 'header_hash', label: 'Header Hash', level: 1, desc: '个人版及以上' },
    { field: 'banner_hash', label: 'Banner Hash', level: 1, desc: '个人版及以上' },
    { field: 'banner_fid', label: 'Banner FID', level: 1, desc: '个人版及以上' },
    // 专业版及以上
    { field: 'cname', label: 'CNAME', level: 3, desc: '专业版及以上' },
    { field: 'lastupdatetime', label: '最后更新时间', level: 3, desc: '专业版及以上' },
    { field: 'product', label: '产品名', level: 3, desc: '专业版及以上' },
    { field: 'product_category', label: '产品分类', level: 3, desc: '专业版及以上' },
    { field: 'product.version', label: '产品版本号', level: 4, desc: '商业版及以上' },
    { field: 'icon_hash', label: 'Icon Hash', level: 4, desc: '商业版及以上' },
    { field: 'cert.is_valid', label: '证书是否有效', level: 4, desc: '商业版及以上' },
    { field: 'cname_domain', label: 'CNAME 域名', level: 4, desc: '商业版及以上' },
    { field: 'body', label: '网站正文', level: 4, desc: '商业版及以上' },
    { field: 'cert.is_match', label: '证书颁发者匹配', level: 4, desc: '商业版及以上' },
    { field: 'cert.is_equal', label: '证书域名匹配', level: 4, desc: '商业版及以上' },
    { field: 'icon', label: 'Icon 图标', level: 5, desc: '企业版' },
    { field: 'fid', label: 'FID', level: 5, desc: '企业版' },
    { field: 'structinfo', label: '结构化信息', level: 5, desc: '企业版' }
];

// ==================== 字段标签映射（兼容旧代码） ====================
export const FIELD_LABELS = {};
FIELDS_CONFIG.forEach(f => {
    FIELD_LABELS[f.field] = f.label;
});
