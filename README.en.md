# FOFA Leak Search

![](https://image.mrxn.net/52b9a53316fd43e2a6a9d4ec8f3c130b.webp)

> English README · [中文文档](README.md)

FOFA cyberspace asset search tool — a cross-platform desktop application built with [Tauri 2](https://tauri.app/).

Based on the [FOFA](https://fofa.info) API, it provides fast search, multi-field filtering, statistics overview, smart sharded download, a rule-library favorites system, icon hash calculation, in-app update checks and more, with built-in F-point protection to prevent accidental charges.

---

## Features

### Search & Filtering
- Full FOFA query syntax support with automatic Base64 encoding
- **51 result fields**, unlocked dynamically by account tier (Free 34 / Personal 3 / Professional 4 / Business 7 / Enterprise 3)
- **Quick filter panel**: base query, application/product, asset labels, protocol, geolocation, certificate and more
  - **Multiple conditions per field stack**: `port!=25` and `port!=587` can coexist (`port!="25" && port!="587"`), shown as chips that can be removed individually
  - **Multi-values merged per FOFA semantics**: `=` / `*=` are joined with `||` and wrapped in parentheses; `!=` / `==` are joined with `&&` independently
  - When the search box contains `||`, it is wrapped in parentheses before filter conditions are appended, avoiding `&&` / `||` precedence ambiguity
- **FOFA rule library**: 74 built-in query templates with search filtering and one-click fill; system rules cannot be deleted
- **Favorite queries**: save a query together with its filter conditions and restore instantly; a built-in rule combined with filters can be saved as a separate user favorite without conflicts
- **Search history**: query statements and their filter conditions are saved automatically
- Result URLs open in the system default browser; **"Open all"** opens every link on the current page at once (confirmation required above 20 links, staggered 300 ms apart to avoid pop-up blocking)
- Copy the current query; drag-to-resize table columns (`div + flex` layout, resizable even under WebKitGTK)
- **No cap on favorites or history**: capacity is limited only by local storage; the oldest user entries are evicted with a notice when space runs low; built-in system rules are never removed

### Statistics Overview
- One-click aggregate distribution for the current query (IP / title / domain / server / port / country / organization, etc.), one card per dimension (name + bar share + count + percentage)
- Summary cards: total assets, unique IPs / titles / domains / servers / ICPs / FIDs, data update time
- **Screenshot export**: render the statistics area to PNG (`fofa_stats_<YYYYMMDD-HHmmss>.png`)

### Data Export
- Download the current page / all results / a custom page range / all pages
- **Concurrent downloads**: 1 / 3 / 5 / 10 / 20 parallel workers with dynamic inter-batch delays against rate limiting
- **Smart sharded download** (analyze → plan → preflight → execute pipeline)
  - Automatically analyzes the result distribution (ASN, country, port, server, organization) and plans a split strategy to bypass single-query limits
  - The **preflight stage** uses `search(size=1)` to get the true total of each step (zero F-point cost, separate rate limit) and shows a yellow deviation hint when the estimate is more than 1.5× off
  - The execution stage always uses `page=1` (paging costs F points with no API warning), eliminating paging charges at the source
  - Steps that truly exceed the limit are recursively split over the next dimension of the Cartesian product (depth limit 3)
  - **Rate-limit adaptation**: on repeated 429s the delay ramps up to 10 s and falls back after every 5 successes (floor 800 ms), persisting across plans
  - Results are deduplicated and merged automatically with live step status, progress and estimated cost
- CSV export with BOM (Chinese characters open correctly in Excel)

### F-Point Protection
- No F points are consumed within the free quota; beyond it you are charged by actual download size (1 F point = 1 record)
- **Spending F points is disabled by default** and must be enabled manually
- Live estimates of download size, API calls and F-point cost
- Quota warnings on search / paging when the monthly quota is low or exhausted
- **F-point red-line dialog during execution**: when actual consumption (`consumed_fpoint > 0`) is detected, a dialog asks for authorization with "Cancel" focused by default; declining aborts the run, keeps already-downloaded data and marks remaining steps as skipped

### Account Management
- Side panel with account info (F-point / balance, quota, permission tier)
- Membership tiers supported (Registered / Personal / Professional / Business / Enterprise)
- Usage statistics dialog: monthly API calls, downloads, F points used, data fetched and a quota progress bar
- Asynchronous refresh with toast notifications

### Configuration
- Unified settings center: API keys, configuration management, export settings, proxy settings, request settings
- **Interface language**: 简体中文 / English — follows the system locale (`LANG` / `LC_*`), Chinese in Chinese locales and English elsewhere; switch manually in Settings at any time
- Configuration import/export (Base64-encoded txt: API key, favorites, history, fields, cache settings, proxy, UA, custom headers, timeout)
  - **Import merges**: favorites and history are deduplicated by full query and merged with local entries taking priority; when a favorite exists on both sides the locally edited name and tags are kept, imported values only fill gaps
  - Built-in system rules always follow the local copy; imported built-in entries never overwrite local data
  - Single-value settings (API key, proxy, timeout, page size, …) are overwritten by the import, but empty values never clear existing local settings; usage stats are not imported
  - **API key overwrite confirmation**: shown only when the imported key is non-empty and different, comparing key suffixes with "Keep current" focused by default
  - A summary is shown afterwards, e.g. "5 favorites added, 7 duplicates skipped; 12 history entries added"
- HTTP/HTTPS/SOCKS5 proxy with an **enable/disable switch**; falls back to direct connection when disabled; state persists across restarts
- Custom User-Agent and HTTP headers (validated front and back: pseudo-headers forbidden, `Host`/`Content-Length` overrides blocked, CRLF injection prevented)
- **Query timeout setting** in request settings: default 30 s, range 5–300 s, effective immediately after saving
- IndexedDB cache with configurable TTL; queries are normalized to avoid cache misses
- Local storage write fallback: when storage is full the oldest data is cleaned and the write retried with a notice — no silent failures or truncated data

### Diagnostic Logs
- "Diagnostic logs" section in settings with enable/disable and level filtering (error / warn / info / debug)
- Log viewer renders the latest 100 entries live, color-coded by level
- Refresh, export to JSON and clear actions
- Passwords / tokens / keys and URL parameters are redacted automatically below debug level
- Covers core modules: API requests, search results, cache reads/writes, update checks, proxy configuration, downloads, icon hash and smart download

### Utilities
- **Icon Hash calculator**: compatible with FOFA's icon_hash algorithm (MurmurHash3 32-bit); works on favicon URLs and local files; results can be copied, **inserted into the query** or filled into filter conditions
  - favicons are fetched through the Rust request pipeline with the configured proxy/UA/headers/timeout, so it works behind a proxy too
- **In-app update check**: automatically checks GitHub Releases on startup and on demand; a banner appears above the search bar when a new version is found
- Native macOS menu bar and standard shortcuts

---

## Download

Download the installer for your platform from the [Releases](https://github.com/Mr-xn/fofa_leak_search/releases) page, or check for updates inside the app:

| Platform | Architecture | Formats |
|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | `.dmg` / `.app.tar.gz` |
| macOS | Intel x86_64 | `.dmg` / `.app.tar.gz` |
| Windows | x64 | `.msi` / `-setup.exe` |
| Windows | ARM64 | `.msi` / `-setup.exe` |
| Linux | x86_64 | `.deb` / `.rpm` / `.AppImage` |
| Linux | ARM64 | `.deb` / `.rpm` |

> On older distributions such as Ubuntu 22.04, pick the packages with the `_ubuntu22` suffix (built against an older glibc).

### macOS
1. Download the `.dmg` and open it
2. Drag `FOFA Leak Search` into the Applications folder
3. If macOS reports the developer cannot be verified on first launch, allow it under "System Settings > Privacy & Security"

### Windows
Download the `.msi` or `-setup.exe` installer and run it.

### Linux
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

## Build from Source

### Prerequisites
- [Rust](https://rustup.rs/) (rustc + cargo)
- [Node.js](https://nodejs.org/) (v18+)
- Platform dependencies per [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

```bash
# Clone the repository
git clone https://github.com/Mr-xn/fofa_leak_search.git
cd fofa_leak_search

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build
```

Build artifacts land in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
fofa_leak_search/
├── frontend/                       # Frontend static assets
│   ├── index.html                  # Main page
│   ├── css/
│   │   └── styles.css              # Stylesheet
│   ├── icons/                      # Frontend icons
│   ├── vendor/
│   │   └── html2canvas.min.js      # Statistics screenshot renderer
│   └── js/                         # ES Module modules
│       ├── api.js                  # FOFA API request wrapper
│       ├── config.js               # Global constants, field permissions, version
│       ├── favorites.js            # Favorite queries and rule library integration
│       ├── fofa-rules.js           # Built-in FOFA rule library
│       ├── i18n/                   # Interface localization (zh-CN / en)
│       │   ├── index.js            # Locale detection and t() lookup
│       │   └── locales/en/         # English string dictionaries
│       ├── icon-hash.js            # Icon Hash calculator
│       ├── logger.js               # Diagnostic logging system
│       ├── main.js                 # Main entry point
│       ├── query-normalizer.js     # Query normalization
│       ├── quota.js                # Storage quota writes and oldest-entry eviction
│       ├── results.js              # Result table rendering, downloads, open-all
│       ├── screenshot.js           # Node screenshot export
│       ├── search.js               # Search logic
│       ├── smart-downloader.js     # Smart sharded download (analyze/plan/preflight/execute)
│       ├── stats.js                # Statistics overview
│       ├── storage.js              # localStorage / IndexedDB wrappers
│       ├── tauri-bridge.js         # Tauri command bridge
│       ├── ui.js                   # Shared UI components, settings center, config import/export
│       ├── updater.js              # In-app update checks
│       ├── user-info.js            # Account information
│       └── utils.js                # Utilities, dialogs, clipboard
├── src-tauri/                      # Tauri 2 project
│   ├── Cargo.toml                  # Rust dependencies
│   ├── tauri.conf.json             # App configuration
│   ├── capabilities/
│   │   └── default.json            # Capability declarations
│   ├── icons/                      # App icons
│   └── src/
│       ├── main.rs                 # Rust entry point
│       ├── lib.rs                  # Tauri application logic
│       ├── proxy.rs                # Built-in HTTP proxy (axum)
│       └── dedup.rs                # Download result deduplication
└── .github/workflows/              # CI/CD workflows
```

---

## Tech Stack

| Layer | Technology |
|----|------|
| Desktop framework | Tauri 2 (Rust) |
| HTTP proxy | axum + reqwest |
| Frontend | HTML + CSS + JavaScript (ES Modules) |
| Storage | localStorage + IndexedDB |
| Screenshot rendering | html2canvas |
| CI/CD | GitHub Actions (macOS / Windows / Linux, x64 and arm64) |

---

## Getting Started

1. **Get an API key**: log in to [FOFA](https://fofa.info) and copy it from the [user center](https://fofa.info/userInfo)
2. **Initial setup**: open the app → "Settings" → paste the API key; configure proxy, User-Agent, headers and timeout as needed
3. **Search**: type a query (e.g. `title="login"`) or fill one from the rule library / favorites panel
4. **Combine filters**: open the "Filters" panel to combine protocol, region, certificate and asset-label conditions; multiple conditions stack on the same field and can be removed chip by chip
5. **Inspect statistics**: expand "Stats" for asset distribution and unique IP/domain summaries; click "Screenshot" to export a PNG
6. **Helper tools**: use the built-in Icon Hash calculator to generate an icon_hash and insert it into the query or filters
7. **Export results**: "Download" → pick normal or smart sharded download → start; for large exports prefer smart sharded download and review the plan and estimates first
8. **Save queries**: click ⭐ to favorite a query; restore it with its filters from the favorites panel next time

---

## License

MIT License

---

## Author

**Mrxn** · [GitHub](https://github.com/Mr-xn)
