use axum::{extract::Query, http::StatusCode, response::Json, routing::get, Router};
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const FOFA_HOST: &str = "fofa.info";
const PREFERRED_PORT: u16 = 18080;

/// 代理服务器状态（存入 Tauri State，供前端查询端口）
pub struct ProxyState {
    pub port: u16,
}

/// 共享的 HTTP 客户端（连接池复用）
struct AppState {
    client: Client,
}

/// 启动 API 代理服务器（异步版本，在 Tauri 运行时中调用）
pub async fn start_proxy_server() -> (u16, broadcast::Sender<()>) {
    // 构建 reqwest 客户端（禁用证书验证，匹配原 server.py 行为）
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("curl/8.20.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    let state = Arc::new(AppState { client });

    // 构建路由
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/{*path}", get(proxy_get_handler).post(proxy_post_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    // 尝试首选端口，失败则随机
    let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", PREFERRED_PORT)).await {
        Ok(l) => {
            println!("[Proxy] Bound to port {}", PREFERRED_PORT);
            l
        }
        Err(_) => {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("Failed to bind to random port");
            println!("[Proxy] Bound to random port {}", l.local_addr().unwrap().port());
            l
        }
    };

    let port = listener.local_addr().unwrap().port();
    let (shutdown_tx, shutdown_rx) = broadcast::channel::<()>(1);

    // 在后台任务中启动服务器
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal(shutdown_rx))
            .await
            .expect("Proxy server error");
    });

    println!("[Proxy] API proxy ready on http://127.0.0.1:{}", port);
    (port, shutdown_tx)
}

/// 优雅关闭信号
async fn shutdown_signal(mut rx: broadcast::Receiver<()>) {
    let _ = rx.recv().await;
}

/// 健康检查
async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "mode": "tauri-rust-proxy"
    }))
}

/// 代理 GET 请求到 FOFA API
async fn proxy_get_handler(
    Query(params): Query<HashMap<String, String>>,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    proxy_request(&state.client, "GET", &path, Some(&params)).await
}

/// 代理 POST 请求到 FOFA API
async fn proxy_post_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Path(path): axum::extract::Path<String>,
    body: String,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let params: HashMap<String, String> = serde_urlencoded::from_str(&body).unwrap_or_default();
    proxy_request(&state.client, "POST", &path, Some(&params)).await
}

/// 核心代理逻辑
async fn proxy_request(
    client: &Client,
    method: &str,
    path: &str,
    params: Option<&HashMap<String, String>>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    // 路径转换: /api/xxx -> /api/v1/xxx
    let api_path = if path.starts_with("api/") {
        path.replacen("api/", "api/v1/", 1)
    } else {
        format!("api/v1/{}", path)
    };

    // 构建完整 URL
    let mut url = format!("https://{}/{}", FOFA_HOST, api_path);
    if let Some(p) = params {
        if !p.is_empty() {
            let qs: String = p
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("&");
            url = format!("{}?{}", url, qs);
        }
    }

    println!("[Proxy] {} {}", method, url);

    let req = match method {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            println!("[Proxy] Response: {}", status);
            Ok((StatusCode::from_u16(status.as_u16()).unwrap(), body))
        }
        Err(e) => {
            eprintln!("[Proxy] Error: {}", e);
            Err((
                StatusCode::BAD_GATEWAY,
                serde_json::json!({
                    "error": true,
                    "errmsg": format!("Proxy error: {}", e)
                })
                .to_string(),
            ))
        }
    }
}
