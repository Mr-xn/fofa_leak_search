# FOFA Leak Search

![](https://image.mrxn.net/a391f1b2aa6f42f7a8b1bd11e3835046.webp)

FOFA 网络空间资产搜索工具 — 跨平台桌面应用，基于 [Tauri 2](https://tauri.app/) 构建。

基于 [FOFA](https://fofa.info) API，提供快速搜索、多字段筛选、智能分片下载、规则库收藏、Icon Hash 计算、在线更新检测等功能，内置 F 点保护机制防止意外扣费。

## 最近更新

### v1.2.1
- 新增 **诊断日志系统**：设置面板支持启用/关闭、等级筛选（error/warn/info/debug），日志查看器支持刷新、导出 JSON、清空，非 debug 等级自动脱敏敏感字段
- 新增 **代理启用/禁用开关**：一键启用或禁用代理，状态持久化，关闭时自动切换为直连模式
- 优化 **收藏查询面板**：支持内联编辑别名、自定义标签增删改、标签行折叠/展开
- 修复 `isIPv6()` 误判 HTTP URL 导致 link 列被截断的 bug
- 修复 Rust 代理层转发查询参数时未 URL 编码的问题
- 修复 WebKit2GTK 收藏面板 CPU 飙升（移除 `backdrop-filter` 等高耗能 CSS）
- 跨平台 WebView 性能优化（列宽拖动节流、`transition` 精简、动画限制）
- Linux 设置弹窗文字清晰度修复（字体栈补充、对比度提升至 WCAG AA）
- 修复代理禁用后重启仍走代理的 bug

### v1.2.0
- 新增 **FOFA 规则库**，首次启动自动注入内置查询模板并支持一键填充
- 新增 **Icon Hash 计算器**，支持 URL favicon 与本地文件两种计算方式
- 新增 **在线更新检测** 与手动检查更新入口
- 新增 **收藏查询功能**，可保存查询语句和筛选条件并快速恢复

### v1.1.0
- 新增 **智能分片下载**，可自动规划分片策略并去重合并结果
- 设置中心整合 **API / 配置管理 / 导出 / 代理 / 请求设置**
- 支持 **HTTP/HTTPS/SOCKS5 代理**、自定义 **User-Agent / Headers**
- 搜索结果 URL 支持点击打开，新增复制查询、列宽拖动、macOS 菜单栏支持

---

## 功能特性

### 搜索与筛选
- 支持 FOFA 全部查询语法，Base64 自动编码
- **51 个返回字段**，根据账户权限动态解锁（免费 34 个，个人版+更多）
- **快速筛选面板**：基础查询、应用/产品、资产标记、协议、地理位置、证书等多分类筛选
- **FOFA 规则库**：内置常用语法模板，支持搜索过滤、一键填充
- **收藏查询**：保存查询语句与关联筛选条件，支持快速恢复
- 搜索历史记录，自动保存关联筛选条件
- 搜索结果 URL 支持直接调用系统默认浏览器打开
- 支持复制当前查询语句、表格列宽拖动调整

### 数据导出
- 下载当前页 / 一键下载全部 / 自定义页数范围 / 全部分页下载
- **并发下载**：支持 1~20 并发数，批次间动态延迟防限流
- **智能分片下载**：自动分析结果分布并规划分片策略，绕过单次查询限制
- 进度实时展示（状态 + 进度条 + 详细信息）
- CSV 格式导出（含 BOM 支持中文）

### F 点保护
- 免费额度内不扣 F 点，超出后按实际下载量扣费
- **默认禁止使用 F 点**，需手动开启
- 实时预估下载条数、API 调用次数、F 点消耗
- 搜索/翻页时实时配额警告

### 账户管理
- 侧边面板展示账户信息（F 点/币余额、配额、权限等级）
- 会员等级体系支持（注册用户/个人版/专业版/商业版/企业版）
- 异步刷新 + toast 提示

### 配置管理
- 统一设置中心：API 配置、配置管理、导出设置、代理设置、请求设置
- 配置导入/导出（API Key、历史、字段、缓存设置、代理、UA、自定义 Headers）
- 支持 HTTP/HTTPS/SOCKS5 代理，带**启用/禁用开关**，关闭时自动切换为直连模式，状态跨重启持久化
- 支持自定义 User-Agent 与 HTTP Headers
- IndexedDB 缓存，可配置有效期
- 查询语句规范化，避免缓存未命中

### 诊断日志
- 设置面板「诊断日志」分区，支持启用/关闭与等级筛选（error / warn / info / debug）
- 日志查看器实时渲染最近 100 条日志，按等级颜色区分
- 支持刷新日志、导出 JSON 文件、清空日志
- 非 debug 等级自动脱敏密码/token/key 字段和 URL 参数
- 覆盖核心模块：API 请求、搜索结果、缓存读写、更新检测、代理配置、下载任务、Icon Hash、智能下载

### 辅助工具
- **Icon Hash 计算器**：兼容 FOFA icon_hash 算法，可复制结果或直接带入筛选
- **在线更新检测**：启动自动检查 GitHub Releases，也支持手动检查
- macOS 原生菜单栏与常用快捷键支持

---

## 下载

从 [Releases](https://github.com/Mr-xn/fofa_leak_search/releases) 页面下载对应平台的安装包：

| 平台 | 架构 | 格式 |
|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | `.dmg` / `.app.tar.gz` |
| macOS | Intel x86_64 | `.dmg` / `.app.tar.gz` |
| Windows | x64 | `.msi` / `.exe` |
| Windows | ARM64 | `.msi` / `.exe` |
| Linux | x64 | `.AppImage` / `.deb` |
| Linux | ARM64 | `.AppImage` / `.deb` |

### macOS 安装说明
1. 下载 `.dmg` 文件，双击打开
2. 将 `FOFA Leak Search` 拖入 Applications 文件夹
3. 首次打开如提示"无法验证开发者"，前往「系统设置 > 隐私与安全性」允许运行

### Windows 安装说明
下载 `.msi` 或 `.exe` 安装程序，双击运行即可。

### Linux 安装说明
```bash
# AppImage
chmod +x fofa-leak-search*.AppImage
./fofa-leak-search*.AppImage

# Deb
sudo dpkg -i fofa-leak-search*.deb
```

---

## 从源码构建

### 前置条件
- [Rust](https://rustup.rs/) (rustc + cargo)
- [Node.js](https://nodejs.org/) (v18+)

```bash
# 克隆仓库
git clone https://github.com/Mr-xn/fofa_leak_search.git
cd fofa_leak_search

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 运行测试
npm test

# 生产构建
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

---

## 项目结构

```
fofa_leak_search/
├── frontend/                   # 前端静态资源
│   ├── index.html              # 主页面
│   ├── css/
│   │   └── styles.css          # 样式表
│   └── js/                     # ES Module 模块
│       ├── api.js              # FOFA API 请求封装
│       ├── config.js           # 全局常量与版本号
│       ├── favorites.js        # 收藏查询
│       ├── fofa-rules.js       # FOFA 规则库
│       ├── icon-hash.js        # Icon Hash 计算器
│       ├── logger.js           # 诊断日志系统
│       ├── query-normalizer.js # 查询语句规范化
│       ├── results.js          # 搜索结果渲染
│       ├── search.js           # 搜索逻辑
│       ├── smart-downloader.js # 智能分片下载
│       ├── stats.js            # 账户统计
│       ├── storage.js          # localStorage / IndexedDB 封装
│       ├── tauri-bridge.js     # Tauri 命令桥接
│       ├── ui.js               # 通用 UI 组件与交互
│       ├── updater.js          # 在线更新检测
│       ├── user-info.js        # 账户信息
│       └── main.js             # 主入口
├── src-tauri/                  # Tauri 2 项目
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # 应用配置
│   ├── icons/                  # 应用图标
│   └── src/
│       ├── main.rs             # Rust 入口
│       ├── lib.rs              # Tauri 应用逻辑
│       └── proxy.rs            # 内置 HTTP 代理 (axum)
└── .github/workflows/          # CI/CD 工作流
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 (Rust) |
| HTTP 代理 | axum + reqwest |
| 前端 | HTML + CSS + JavaScript (ES Module) |
| 存储 | localStorage + IndexedDB |
| CI/CD | GitHub Actions (6 平台) |

---

## 使用说明

1. **获取 API Key**：登录 [FOFA](https://fofa.info)，前往 [个人中心](https://fofa.info/userInfo) 获取
2. **完成初始化配置**：打开应用 → 进入「设置」→ 填入 API Key，并按需配置代理、User-Agent、Headers
3. **发起搜索**：输入查询语句（如 `title="登录"`）或从规则库/收藏面板一键填充查询
4. **组合筛选**：点击「筛选」按钮展开面板，自动组合协议、地域、证书、资产标记等条件
5. **辅助分析**：需要 icon_hash 时可直接使用内置 Icon Hash 计算器生成并回填条件
6. **导出结果**：点击「下载数据」→ 选择普通下载或智能分片下载 → 开始导出

---

## 许可证

MIT License

---

## 作者

**Mrxn** · [GitHub](https://github.com/Mr-xn)
