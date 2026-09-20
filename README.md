# FOFA Leak Search

![](https://image.mrxn.net/52b9a53316fd43e2a6a9d4ec8f3c130b.webp)

FOFA 网络空间资产搜索工具 — 跨平台桌面应用，基于 [Tauri 2](https://tauri.app/) 构建。

基于 [FOFA](https://fofa.info) API，提供快速搜索、多字段筛选、统计概览、智能分片下载、规则库收藏、Icon Hash 计算、在线更新检测等功能，内置 F 点保护机制防止意外扣费。

---

## 功能特性

### 搜索与筛选
- 支持 FOFA 全部查询语法，Base64 自动编码
- **51 个返回字段**，按账户权限动态解锁（免费 34 个 / 个人版 3 个 / 专业版 4 个 / 商业版 7 个 / 企业版 3 个）
- **快速筛选面板**：基础查询、应用/产品、资产标记、协议、地理位置、证书等多分类筛选
  - **同字段多条件叠加**：`port!=25` 与 `port!=587` 可并存（`port!="25" && port!="587"`），条件以 chip 展示、可单独删除
  - **按 FOFA 语义合并多值**：`=` / `*=` 用 `||` 连接并整体括号包裹，`!=` / `==` 各自独立用 `&&` 连接
  - 搜索框含 `||` 时自动整体加括号再拼接筛选条件，避免 `&&` / `||` 优先级歧义
- **FOFA 规则库**：内置 74 条常用语法模板，支持搜索过滤、一键填充；系统规则不可删除
- **收藏查询**：保存查询语句与关联筛选条件，支持快速恢复；内置规则叠加筛选条件后可单独收藏为一条用户收藏，互不覆盖
- **搜索历史**：自动保存查询语句与关联筛选条件
- 搜索结果 URL 支持调用系统默认浏览器打开；**「全部打开」** 一键打开当前页所有链接（超过 20 条时先确认，300ms 错峰规避拦截）
- 复制当前查询语句、表格列宽拖动调整（基于 `div + flex` 布局，WebKitGTK 下同样可拖窄）
- **收藏与搜索历史不设条数上限**：能存多少由本机剩余存储空间决定；空间不足时自动淘汰最旧的用户条目并提示，系统内置规则永不删除

### 统计概览
- 一键拉取当前查询的聚合分布（IP / 标题 / 域名 / Server / 端口 / 国家 / 组织等），每个维度一张分布卡片（名称 + 条形占比 + 条数 + 百分比）
- 汇总卡片：资产总数、独立 IP / 标题 / 域名 / Server / ICP / FID 数量、数据更新时间
- **截图导出**：将统计区渲染为 PNG 下载（`fofa_stats_<YYYYMMDD-HHmmss>.png`）

### 数据导出
- 下载当前页 / 一键下载全部 / 自定义页数范围 / 全部分页下载
- **并发下载**：1 / 3 / 5 / 10 / 20 并发数可选，批次间动态延迟防限流
- **智能分片下载**（分析 → 规划 → 预查 → 执行 四阶段流水线）
  - 自动分析结果分布（ASN、国家、端口、服务器、组织）并规划拆分策略，绕过单次查询限制
  - **预查阶段**用 `search(size=1)` 取每一步的真实总数（零 F 点消耗、独立限流），估算偏低超过 1.5 倍时给出黄色偏差提示
  - 执行阶段固定 `page=1`（翻页会扣 F 点且接口无提示），从源头杜绝翻页扣费
  - 真实超限的步骤用笛卡尔积下一个维度递归拆分（深度上限 3）
  - **限流自适应**：连续触发 429 时延迟最多升至 10s，每 5 次成功后回落（下限 800ms），跨多次规划保持
  - 自动去重合并结果，实时展示步骤状态、进度与预估消耗
- CSV 格式导出（含 BOM，Excel 打开中文不乱码）

### F 点保护
- 免费额度内不扣 F 点，超出后按实际下载量扣费（1 F点 = 1 条数据）
- **默认禁止使用 F 点**，需手动开启
- 实时预估下载条数、API 调用次数、F 点消耗
- 搜索 / 翻页时实时配额警告，当月配额不足或已用尽时提示
- **执行阶段 F 点红线弹窗**：检测到实际扣点（`consumed_fpoint > 0`）时弹窗请求授权，默认聚焦「取消」防误点；拒绝后中止执行、保留已下载数据，剩余步骤标记为跳过

### 账户管理
- 侧边面板展示账户信息（F 点/币余额、配额、权限等级）
- 会员等级体系支持（注册用户/个人版/专业版/商业版/企业版）
- 使用统计弹窗：当月 API 调用数、下载数、F 点消耗、数据获取量与配额进度条
- 异步刷新 + toast 提示

### 配置管理
- 统一设置中心：API 配置、配置管理、导出设置、代理设置、请求设置
- 配置导入/导出（Base64 编码 txt，含 API Key、收藏、搜索历史、字段、缓存设置、代理、UA、自定义 Headers、超时）
  - **导入为合并语义**：收藏与搜索历史按完整查询语句去重后与本机合并，本机条目优先；同一条收藏两边都有时保留本机改过的名称与标签，仅在本机缺失时用导入值补全
  - 系统内置规则始终以本机为准，导入文件里的内置条目不会覆盖本机数据
  - 单值配置（API Key、代理、超时、每页条数等）覆盖导入，但空值不会清空本机已有配置；用量统计不参与导入
  - **API Key 覆盖前确认**：仅当导入的 Key 非空且与本机不同时弹窗，双方 Key 尾号对照，默认聚焦「保留当前」
  - 导入完成给出明细，例如「收藏新增 5 条、跳过 7 条重复；历史新增 12 条」
- 支持 HTTP/HTTPS/SOCKS5 代理，带**启用/禁用开关**，关闭时自动切换为直连模式，状态跨重启持久化
- 支持自定义 User-Agent 与 HTTP Headers（前后端双重校验：禁止伪头部、禁止覆盖 `Host`/`Content-Length`、防 CRLF 注入）
- **查询超时配置**：请求设置中可调，默认 30 秒，范围 5–300 秒，保存后即时生效
- IndexedDB 缓存，有效期可配置；查询语句规范化，避免缓存未命中
- 本地存储写入兜底：空间写满时自动清理最旧数据后重试并提示，不再静默失败或截断数据

### 诊断日志
- 设置面板「诊断日志」分区，支持启用/关闭与等级筛选（error / warn / info / debug）
- 日志查看器实时渲染最近 100 条日志，按等级颜色区分
- 支持刷新日志、导出 JSON 文件、清空日志
- 非 debug 等级自动脱敏密码/token/key 字段和 URL 参数
- 覆盖核心模块：API 请求、搜索结果、缓存读写、更新检测、代理配置、下载任务、Icon Hash、智能下载

### 辅助工具
- **Icon Hash 计算器**：兼容 FOFA icon_hash 算法（MurmurHash3 32-bit），支持 URL favicon 与本地文件，可复制结果、**填入查询语句**或填入筛选条件
  - favicon 获取走 Rust 侧已配置好代理/UA/Headers/超时的请求管线，配置代理后同样可用
- **在线更新检测**：启动自动检查 GitHub Releases，也支持手动检查；发现新版本在搜索栏上方显示横幅
- macOS 原生菜单栏与常用快捷键支持

---

## 下载

从 [Releases](https://github.com/Mr-xn/fofa_leak_search/releases) 页面下载对应平台的安装包，或在应用内直接检查更新：

| 平台 | 架构 | 格式 |
|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | `.dmg` / `.app.tar.gz` |
| macOS | Intel x86_64 | `.dmg` / `.app.tar.gz` |
| Windows | x64 | `.msi` / `-setup.exe` |
| Windows | ARM64 | `.msi` / `-setup.exe` |
| Linux | x86_64 | `.deb` / `.rpm` / `.AppImage` |
| Linux | ARM64 | `.deb` / `.rpm` |

> Ubuntu 22.04 等较旧发行版请选择文件名带 `_ubuntu22` 后缀的安装包（面向更低版本 glibc 构建）。

### macOS 安装说明
1. 下载 `.dmg` 文件，双击打开
2. 将 `FOFA Leak Search` 拖入 Applications 文件夹
3. 首次打开如提示"无法验证开发者"，前往「系统设置 > 隐私与安全性」允许运行

### Windows 安装说明
下载 `.msi` 或 `-setup.exe` 安装程序，双击运行即可。

### Linux 安装说明
```bash
# AppImage
chmod +x FOFA.Leak.Search*.AppImage
./FOFA.Leak.Search*.AppImage

# Deb
sudo dpkg -i FOFA.Leak.Search*.deb

# Rpm
sudo rpm -ivh FOFA.Leak.Search*.rpm
```

---

## 从源码构建

### 前置条件
- [Rust](https://rustup.rs/) (rustc + cargo)
- [Node.js](https://nodejs.org/) (v18+)
- 各平台系统依赖见 [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

```bash
# 克隆仓库
git clone https://github.com/Mr-xn/fofa_leak_search.git
cd fofa_leak_search

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

---

## 项目结构

```
fofa_leak_search/
├── frontend/                       # 前端静态资源
│   ├── index.html                  # 主页面
│   ├── css/
│   │   └── styles.css              # 样式表
│   ├── icons/                      # 前端图标
│   ├── vendor/
│   │   └── html2canvas.min.js      # 统计截图渲染库
│   └── js/                         # ES Module 模块
│       ├── api.js                  # FOFA API 请求封装
│       ├── config.js               # 全局常量、字段权限与版本号
│       ├── favorites.js            # 收藏查询与规则库整合
│       ├── fofa-rules.js           # FOFA 内置规则库
│       ├── icon-hash.js            # Icon Hash 计算器
│       ├── logger.js               # 诊断日志系统
│       ├── main.js                 # 主入口
│       ├── query-normalizer.js     # 查询语句规范化
│       ├── quota.js                # 存储配额写入与最旧条目淘汰
│       ├── results.js              # 结果表格渲染、下载与全部打开
│       ├── screenshot.js           # 节点截图导出
│       ├── search.js               # 搜索逻辑
│       ├── smart-downloader.js     # 智能分片下载（分析/规划/预查/执行）
│       ├── stats.js                # 统计概览
│       ├── storage.js              # localStorage / IndexedDB 封装
│       ├── tauri-bridge.js         # Tauri 命令桥接
│       ├── ui.js                   # 通用 UI 组件、设置中心与配置导入导出
│       ├── updater.js              # 在线更新检测
│       ├── user-info.js            # 账户信息
│       └── utils.js                # 工具函数、弹窗与剪贴板
├── src-tauri/                      # Tauri 2 项目
│   ├── Cargo.toml                  # Rust 依赖
│   ├── tauri.conf.json             # 应用配置
│   ├── capabilities/
│   │   └── default.json            # 权限声明
│   ├── icons/                      # 应用图标
│   └── src/
│       ├── main.rs                 # Rust 入口
│       ├── lib.rs                  # Tauri 应用逻辑
│       ├── proxy.rs                # 内置 HTTP 代理 (axum)
│       └── dedup.rs                # 下载结果去重
└── .github/workflows/              # CI/CD 工作流
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 (Rust) |
| HTTP 代理 | axum + reqwest |
| 前端 | HTML + CSS + JavaScript (ES Module) |
| 存储 | localStorage + IndexedDB |
| 截图渲染 | html2canvas |
| CI/CD | GitHub Actions（macOS / Windows / Linux，x64 与 arm64 双架构） |

---

## 使用说明

1. **获取 API Key**：登录 [FOFA](https://fofa.info)，前往 [个人中心](https://fofa.info/userInfo) 获取
2. **完成初始化配置**：打开应用 → 进入「设置」→ 填入 API Key，并按需配置代理、User-Agent、Headers、超时
3. **发起搜索**：输入查询语句（如 `title="登录"`）或从规则库/收藏面板一键填充查询
4. **组合筛选**：点击「筛选」按钮展开面板，自动组合协议、地域、证书、资产标记等条件；同一字段可叠加多个条件，chip 上可逐个删除
5. **查看统计**：展开「统计概览」查看资产分布与独立 IP/域名等汇总，需要留档时点击「截图」导出 PNG
6. **辅助分析**：需要 icon_hash 时可用内置 Icon Hash 计算器生成并填入查询语句或筛选条件
7. **导出结果**：点击「下载数据」→ 选择普通下载或智能分片下载 → 开始导出；大批量导出建议用智能分片下载，先确认规划与预估再执行
8. **沉淀查询**：常用查询点击 ⭐ 收藏，下次从收藏面板一键恢复查询语句与筛选条件

---

## 许可证

MIT License

---

## 作者

**Mrxn** · [GitHub](https://github.com/Mr-xn)
