# FOFA Leak Search

![](https://image.mrxn.net/a391f1b2aa6f42f7a8b1bd11e3835046.webp)

FOFA 网络空间资产搜索工具 — 跨平台桌面应用，基于 [Tauri 2](https://tauri.app/) 构建。

基于 [FOFA](https://fofa.info) API，提供快速搜索、多字段筛选、数据导出、并发下载等功能，内置 F 点保护机制防止意外扣费。

---

## 功能特性

### 搜索与筛选
- 支持 FOFA 全部查询语法，Base64 自动编码
- **51 个返回字段**，根据账户权限动态解锁（免费 34 个，个人版+更多）
- **快速筛选面板**：基础查询、应用/产品、资产标记、协议、地理位置、证书等多分类筛选
- 搜索历史记录，自动保存关联筛选条件

### 数据导出
- 下载当前页 / 一键下载全部 / 自定义页数范围 / 全部分页下载
- **并发下载**：支持 1~20 并发数，批次间动态延迟防限流
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
- 配置导入/导出（API Key、历史、字段、缓存设置）
- IndexedDB 缓存，可配置有效期
- 查询语句规范化，避免缓存未命中

---

## 下载

从 [Releases](https://github.com/Mr-xn/fofa-leak-search/releases) 页面下载对应平台的安装包：

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
git clone https://github.com/Mr-xn/fofa-leak-search.git
cd fofa-leak-search

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
fofa-leak-search/
├── index.html                  # 主页面（HTML + CSS + JS）
├── js/                         # ES Module 模块
│   ├── config.js               # 配置常量和状态管理
│   ├── utils.js                # 工具函数
│   ├── query-normalizer.js     # 查询语句规范化
│   ├── storage.js              # localStorage + IndexedDB
│   ├── api.js                  # API 请求封装
│   ├── tauri-bridge.js         # Tauri 桌面环境适配
│   ├── ui.js                   # UI 交互
│   ├── search.js               # 搜索功能
│   ├── results.js              # 结果展示 + 下载
│   └── main.js                 # 主入口
├── src-tauri/                  # Tauri 2 项目
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # 应用配置
│   ├── icons/                  # 应用图标
│   └── src/
│       ├── main.rs             # Rust 入口
│       ├── lib.rs              # Tauri 应用逻辑
│       └── proxy.rs            # 内置 HTTP 代理 (axum)
├── scripts/                    # 构建脚本
└── .github/workflows/          # CI/CD (6 平台自动构建)
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
2. **配置 API Key**：打开应用 → 点击「API 配置」→ 输入 Key → 保存
3. **搜索**：输入查询语句（如 `title="登录"`）→ 点击搜索
4. **筛选**：点击「筛选」按钮展开面板，选择条件自动组合
5. **导出**：点击「下载数据」→ 选择范围 → 开始下载

---

## 许可证

MIT License

---

## 作者

**Mrxn** · [GitHub](https://github.com/Mr-xn)
