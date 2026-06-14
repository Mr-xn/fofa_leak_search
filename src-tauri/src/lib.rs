use std::sync::Mutex;

mod proxy;

/// 代理端口状态（全局单例）
struct ProxyPort {
    port: Mutex<u16>,
}

/// 获取代理服务器端口（供前端查询）
#[tauri::command]
fn get_proxy_port(state: tauri::State<'_, ProxyPort>) -> u16 {
    *state.port.lock().unwrap()
}

/// 用系统默认浏览器打开 URL
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 在独立的 Tokio 运行时中启动代理服务器（在 Tauri 窗口创建前）
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let (port, _shutdown_tx) = rt.block_on(proxy::start_proxy_server());

    // 把运行时泄漏掉，让后台任务继续运行
    std::mem::forget(rt);

    println!("[Tauri] Proxy server running on port {}", port);

    tauri::Builder::default()
        .manage(ProxyPort {
            port: Mutex::new(port),
        })
        .invoke_handler(tauri::generate_handler![get_proxy_port, open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
