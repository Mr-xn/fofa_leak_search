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
        .invoke_handler(tauri::generate_handler![get_proxy_port, set_proxy_config_cmd, get_proxy_config_cmd, set_request_config_cmd, get_request_config_cmd, open_url, check_github_update_cmd, dedup::dedup_results, dedup::dedup_single])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
