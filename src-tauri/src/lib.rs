use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem};

mod proxy;
mod dedup;

/// 代理端口状态（全局单例）
struct ProxyPort {
    port: Mutex<u16>,
}

/// 获取代理服务器端口（供前端查询）
#[tauri::command]
fn get_proxy_port(state: tauri::State<'_, ProxyPort>) -> u16 {
    *state.port.lock().unwrap()
}

/// 设置外部代理配置（供前端调用）
#[tauri::command]
fn set_proxy_config_cmd(
    state: tauri::State<'_, proxy::AppState>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    proxy::set_proxy_config(state, host, port, username, password)
}

/// 获取当前代理配置（供前端调用）
#[tauri::command]
fn get_proxy_config_cmd(
    state: tauri::State<'_, proxy::AppState>,
) -> Result<Option<proxy::ProxyConfig>, String> {
    proxy::get_proxy_config(state)
}

/// 设置请求配置（User-Agent + 自定义 Headers）
#[tauri::command]
fn set_request_config_cmd(
    state: tauri::State<'_, proxy::AppState>,
    user_agent: String,
    custom_headers: std::collections::HashMap<String, String>,
) -> Result<String, String> {
    proxy::set_request_config(state, user_agent, custom_headers)
}

/// 获取当前请求配置
#[tauri::command]
fn get_request_config_cmd(
    state: tauri::State<'_, proxy::AppState>,
) -> Result<proxy::RequestConfig, String> {
    proxy::get_request_config(state)
}

/// 检查 GitHub 最新 release（经过代理）
#[tauri::command]
async fn check_github_update_cmd(
    state: tauri::State<'_, proxy::AppState>,
) -> Result<serde_json::Value, String> {
    proxy::check_github_update(state).await
}

/// 通过已配置代理的 reqwest client 拉取任意 URL 的原始字节（base64 返回），用于 favicon 等场景
#[tauri::command]
async fn fetch_url_raw_cmd(
    state: tauri::State<'_, proxy::AppState>,
    url: String,
) -> Result<proxy::FetchedRaw, String> {
    proxy::fetch_url_raw(state, url).await
}

/// 导出保存结果
#[derive(serde::Serialize)]
pub struct SaveExportResult {
    /// 实际保存的绝对路径
    pub path: String,
    /// 设置的保存目录不可用，已回退系统「下载」目录
    pub dir_fallback: bool,
}

/// 保存导出文件（供前端导出 CSV/日志调用）
///
/// 绕开 WebView 的下载栈：macOS WKWebView / Linux WebKitGTK 对大文件 blob 下载
/// 会静默截断或不触发（2026-09-25 双端实测），Rust 直接写盘三端行为一致。
///
/// `target_dir` 为设置面板里的自定义保存目录；空/None 或写入失败时回退系统
/// 「下载」目录（如 macOS 根目录只读，设成 `/` 时必须兜底而不是报错丢文件）。
#[tauri::command]
fn save_export_file(
    filename: String,
    content: String,
    target_dir: Option<String>,
) -> Result<SaveExportResult, String> {
    let fallback = dirs::download_dir().or_else(dirs::home_dir);
    let (path, dir_fallback) =
        write_export_file(target_dir.as_deref(), fallback, &filename, &content)?;
    Ok(SaveExportResult {
        path: path.to_string_lossy().into_owned(),
        dir_fallback,
    })
}

/// 写导出文件：自定义目录优先，创建/写入失败回退兜底目录
///
/// 返回 (实际路径, 是否发生目录回退)。两个目录都失败才报错。
fn write_export_file(
    target: Option<&str>,
    fallback: Option<std::path::PathBuf>,
    filename: &str,
    content: &str,
) -> Result<(std::path::PathBuf, bool), String> {
    let name = sanitize_filename(filename);
    let custom = target.map(str::trim).filter(|s| !s.is_empty());

    if let Some(t) = custom {
        if let Ok(dir) = resolve_export_dir(Some(t), None) {
            let path = unique_path(&dir, &name);
            if std::fs::write(&path, content.as_bytes()).is_ok() {
                return Ok((path, false));
            }
        }
    }

    let dir = resolve_export_dir(None, fallback)?;
    let path = unique_path(&dir, &name);
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入失败: {}", e))?;
    Ok((path, custom.is_some()))
}

/// 解析导出目标目录：自定义目录优先（不存在则创建），空值回退兜底目录
fn resolve_export_dir(
    target: Option<&str>,
    fallback: Option<std::path::PathBuf>,
) -> Result<std::path::PathBuf, String> {
    let dir = match target.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => expand_user_path(p),
        None => fallback.ok_or_else(|| "无法定位下载目录".to_string())?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建目录 {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// 路径写法归一化：`~/x` 与 `~` 展开为家目录；相对路径按家目录解析；绝对路径原样
fn expand_user_path(p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix('~') {
        // 仅展开 `~` 与 `~/...`，不碰 `~foo`（其他用户的家目录）
        if rest.is_empty() || rest.starts_with('/') {
            if let Some(home) = dirs::home_dir() {
                return home.join(rest.trim_start_matches('/'));
            }
        }
    }
    let path = std::path::Path::new(p);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        dirs::home_dir()
            .map(|h| h.join(path))
            .unwrap_or_else(|| path.to_path_buf())
    }
}

/// 打开系统目录选择对话框（设置面板「选择目录」按钮；返回 None = 用户取消）
#[tauri::command]
async fn pick_export_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("选择目录失败: {}", e))?;
    Ok(picked.and_then(dialog_path_to_string))
}

/// dialog FilePath → 字符串路径
fn dialog_path_to_string(fp: tauri_plugin_dialog::FilePath) -> Option<String> {
    use tauri_plugin_dialog::FilePath;
    match fp {
        FilePath::Path(p) => Some(p.to_string_lossy().into_owned()),
        FilePath::Url(u) => u
            .to_file_path()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
    }
}

/// 文件名消毒：只保留 basename，防路径穿越
fn sanitize_filename(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let base = base.trim();
    if base.is_empty() || base == "." || base == ".." {
        "export.txt".to_string()
    } else {
        base.to_string()
    }
}

/// 目标已存在时追加 " (n)"，避免覆盖已有导出
fn unique_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let p = std::path::Path::new(filename);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| filename.to_string());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..1000 {
        let c = dir.join(format!("{} ({}){}", stem, n, ext));
        if !c.exists() {
            return c;
        }
    }
    candidate
}

/// 用系统默认浏览器打开 URL（健壮版）
/// 优先级: open::that() > 系统命令 > 错误
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // 1. 规范化 URL（自动补 scheme）
    let normalized = normalize_url(&url);

    // 2. 严格校验
    validate_url(&normalized)?;

    // 3. 尝试 open crate（跨平台，不经过 shell，安全）
    match open::that(&normalized) {
        Ok(_) => {
            println!("[OpenURL] Opened: {}", normalized);
            return Ok(());
        }
        Err(e) => {
            eprintln!("[OpenURL] open::that failed: {}, falling back to system command", e);
        }
    }

    // 4. 系统命令兜底（open crate 已覆盖绝大多数场景，这里仅作为极端情况保险）
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &normalized])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok(())
}

/// 自动补全 URL scheme（FOFA 场景常见纯 host:port）
fn normalize_url(input: &str) -> String {
    if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!("https://{}", input)
    }
}

/// URL 合法性校验
fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("无效的 URL: {}", e))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("不支持的协议: {}，仅允许 http/https", other)),
    }

    if parsed.host_str().is_none() {
        return Err("URL 缺少主机名".to_string());
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 创建共享的代理状态（Clone，Tauri 和代理服务器共用）
    let proxy_state = proxy::AppState::new_shared();

    // 在独立的 Tokio 运行时中启动代理服务器（在 Tauri 窗口创建前）
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let (port, _shutdown_tx) = rt.block_on(proxy::start_proxy_server(proxy_state.clone()));

    // 把运行时泄漏掉，让后台任务继续运行
    std::mem::forget(rt);

    println!("[Tauri] Proxy server running on port {}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProxyPort {
            port: Mutex::new(port),
        })
        .manage(proxy_state)
        .setup(|app| {
            // macOS 需要菜单栏才能支持系统级快捷键（⌘+Q, ⌘+W, ⌘+C 等）
            // Linux/Windows 不需要原生菜单栏，窗口控件由系统窗口管理器提供
            #[cfg(target_os = "macos")]
            {
                let menu = MenuBuilder::new(app)
                    .item(&SubmenuBuilder::new(app, "FOFA Leak Search")
                        .item(&PredefinedMenuItem::about(app, None, None)?)
                        .separator()
                        .item(&PredefinedMenuItem::hide(app, Some("Hide FOFA Leak Search"))?)
                        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
                        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
                        .separator()
                        .item(&PredefinedMenuItem::quit(app, Some("Quit FOFA Leak Search"))?)
                        .build()?)
                    .item(&SubmenuBuilder::new(app, "File")
                        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
                        .build()?)
                    .item(&SubmenuBuilder::new(app, "Edit")
                        .item(&PredefinedMenuItem::undo(app, None)?)
                        .item(&PredefinedMenuItem::redo(app, None)?)
                        .separator()
                        .item(&PredefinedMenuItem::cut(app, None)?)
                        .item(&PredefinedMenuItem::copy(app, None)?)
                        .item(&PredefinedMenuItem::paste(app, None)?)
                        .item(&PredefinedMenuItem::select_all(app, None)?)
                        .build()?)
                    .item(&SubmenuBuilder::new(app, "Window")
                        .item(&PredefinedMenuItem::minimize(app, Some("Minimize"))?)
                        .item(&PredefinedMenuItem::maximize(app, Some("Maximize"))?)
                        .item(&PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?)
                        .separator()
                        .item(&PredefinedMenuItem::bring_all_to_front(app, Some("Bring All to Front"))?)
                        .build()?)
                    .build()?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_proxy_port, set_proxy_config_cmd, get_proxy_config_cmd, set_request_config_cmd, get_request_config_cmd, open_url, check_github_update_cmd, fetch_url_raw_cmd, save_export_file, pick_export_dir, dedup::dedup_results, dedup::dedup_single])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn sanitize_filename_strips_path_components() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("/a/b/evil.csv"), "evil.csv");
        assert_eq!(sanitize_filename("plain.csv"), "plain.csv");
    }

    #[test]
    fn sanitize_filename_rejects_empty_and_dots() {
        assert_eq!(sanitize_filename(".."), "export.txt");
        assert_eq!(sanitize_filename("   "), "export.txt");
        assert_eq!(sanitize_filename(""), "export.txt");
    }

    #[test]
    fn unique_path_appends_counter_instead_of_overwriting() {
        let dir = std::env::temp_dir().join(format!("fofa_export_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let p1 = unique_path(&dir, "a.csv");
        assert_eq!(p1.file_name().unwrap().to_string_lossy(), "a.csv");
        std::fs::write(&p1, "x").unwrap();

        let p2 = unique_path(&dir, "a.csv");
        assert_eq!(p2.file_name().unwrap().to_string_lossy(), "a (1).csv");
        std::fs::write(&p2, "x").unwrap();

        let p3 = unique_path(&dir, "a.csv");
        assert_eq!(p3.file_name().unwrap().to_string_lossy(), "a (2).csv");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_export_dir_prefers_custom_and_creates_it() {
        let base = std::env::temp_dir().join(format!("fofa_dir_test_{}", std::process::id()));
        let target = base.join("nested/exports");
        let dir = resolve_export_dir(Some(target.to_str().unwrap()), Some(base.join("fallback"))).unwrap();
        assert_eq!(dir, target);
        assert!(dir.is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_export_dir_blank_falls_back() {
        let base = std::env::temp_dir().join(format!("fofa_dir_test2_{}", std::process::id()));
        let fb = base.join("Downloads");
        std::fs::create_dir_all(&fb).unwrap();
        let dir = resolve_export_dir(Some("   "), Some(fb.clone())).unwrap();
        assert_eq!(dir, fb);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolve_export_dir_errors_without_any_dir() {
        assert!(resolve_export_dir(None, None).is_err());
        assert!(resolve_export_dir(Some(""), None).is_err());
    }

    #[test]
    fn expand_user_path_supports_common_forms() {
        let home = dirs::home_dir().unwrap();
        // 绝对路径原样
        assert_eq!(expand_user_path("/data/x"), std::path::PathBuf::from("/data/x"));
        // ~ 展开为家目录
        assert_eq!(expand_user_path("~/exports"), home.join("exports"));
        assert_eq!(expand_user_path("~"), home);
        // 相对路径按家目录解析（进程 CWD 不可依赖）
        assert_eq!(expand_user_path("exports"), home.join("exports"));
    }

    #[test]
    fn resolve_export_dir_expands_tilde() {
        let home = dirs::home_dir().unwrap();
        let dir = resolve_export_dir(Some("~/fofa_export_test_tilde"), None).unwrap();
        assert_eq!(dir, home.join("fofa_export_test_tilde"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_export_file_uses_custom_dir_when_writable() {
        let base = std::env::temp_dir().join(format!("fofa_w1_{}", std::process::id()));
        let custom = base.join("custom");
        let fb = base.join("fallback");
        std::fs::create_dir_all(&fb).unwrap();

        let (path, dir_fallback) =
            write_export_file(Some(custom.to_str().unwrap()), Some(fb), "a.csv", "x,y").unwrap();
        assert!(!dir_fallback);
        assert_eq!(path.parent().unwrap(), custom.as_path());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "x,y");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_export_file_falls_back_when_custom_dir_unwritable() {
        let base = std::env::temp_dir().join(format!("fofa_w2_{}", std::process::id()));
        let custom = base.join("readonly_dir");
        let fb = base.join("fallback");
        std::fs::create_dir_all(&custom).unwrap();
        std::fs::create_dir_all(&fb).unwrap();
        // 只读目录（macOS 根目录 `/` 同理不可写）→ 必须回退而不是丢文件
        let mut perms = std::fs::metadata(&custom).unwrap().permissions();
        use std::os::unix::fs::PermissionsExt;
        perms.set_mode(0o555);
        std::fs::set_permissions(&custom, perms.clone()).unwrap();

        let (path, dir_fallback) =
            write_export_file(Some(custom.to_str().unwrap()), Some(fb.clone()), "a.csv", "x").unwrap();
        assert!(dir_fallback);
        assert_eq!(path.parent().unwrap(), fb.as_path());

        perms.set_mode(0o755);
        std::fs::set_permissions(&custom, perms).unwrap();
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_export_file_without_custom_dir_is_no_fallback() {
        let base = std::env::temp_dir().join(format!("fofa_w3_{}", std::process::id()));
        let fb = base.join("fallback");
        std::fs::create_dir_all(&fb).unwrap();

        let (path, dir_fallback) = write_export_file(None, Some(fb.clone()), "a.csv", "x").unwrap();
        assert!(!dir_fallback);
        assert_eq!(path.parent().unwrap(), fb.as_path());
        let _ = std::fs::remove_dir_all(&base);
    }
}
