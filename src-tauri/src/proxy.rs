use axum::{extract::Query, http::StatusCode, response::Json, routing::get, Router};
use reqwest::{header, Client};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

const FOFA_HOST: &str = "fofa.info";
const PREFERRED_PORT: u16 = 18080;
const DEFAULT_UA: &str = "curl/8.21.0";

/// 用户代理配置
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl ProxyConfig {
    fn to_reqwest_proxy(&self) -> Result<reqwest::Proxy, String> {
        let scheme = if self.port == 1080 || self.port == 1081 {
            "socks5"
        } else {
            "http"
        };
        let url = format!("{}://{}:{}", scheme, self.host, self.port);
        let mut proxy = reqwest::Proxy::all(&url).map_err(|e| format!("代理配置无效: {}", e))?;
        if !self.username.is_empty() {
            proxy = proxy.basic_auth(&self.username, &self.password);
        }
        Ok(proxy)
    }
}

/// 请求配置（User-Agent + 自定义 Headers）
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct RequestConfig {
    pub user_agent: String,
    pub custom_headers: HashMap<String, String>,
}

impl Default for RequestConfig {
    fn default() -> Self {
        Self {
            user_agent: DEFAULT_UA.to_string(),
            custom_headers: HashMap::new(),
        }
    }
}

impl RequestConfig {
    /// 验证自定义 header 的合法性
    /// 返回非法 header 列表（空 Vec 表示全部合法）
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        // 禁止的 header 名称（HTTP 库自动管理，不允许覆盖）
        const FORBIDDEN: &[&str] = &[
            "host", "content-length", "transfer-encoding",
            "connection", "keep-alive", "te", "trailer",
            "upgrade", "proxy-authorization", "proxy-authenticate",
        ];

        // HTTP/2 伪头部前缀
        const PSEUDO_PREFIX: char = ':';

        for (name, value) in &self.custom_headers {
            // 1. header 名称不能为空
            if name.is_empty() {
                errors.push("header 名称不能为空".to_string());
                continue;
            }

            // 2. 禁止 HTTP/2 伪头部
            if name.starts_with(PSEUDO_PREFIX) {
                errors.push(format!("禁止设置伪头部: {}", name));
                continue;
            }

            // 3. 禁止覆盖 HTTP 库管理的 header
            if FORBIDDEN.contains(&name.to_lowercase().as_str()) {
                errors.push(format!("禁止手动设置: {}", name));
                continue;
            }

            // 4. header 名称只能是 token 字符 (RFC 7230 §3.2.6)
            if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                errors.push(format!("非法 header 名称: {} (仅允许字母、数字、-、_)", name));
                continue;
            }

            // 5. header 值不能包含控制字符或 CRLF 注入
            if value.contains('\r') || value.contains('\n') {
                errors.push(format!("header 值包含非法换行符: {}", name));
                continue;
            }
            if value.chars().any(|c| (c as u32) < 0x20 && c != '\t') {
                errors.push(format!("header 值包含控制字符: {}", name));
                continue;
            }
        }

        errors
    }
}

/// 可动态更新的 HTTP 客户端包装
struct DynamicClient {
    client: Client,
    proxy_config: Option<ProxyConfig>,
    request_config: RequestConfig,
}

impl DynamicClient {
    fn new() -> Self {
        let config = RequestConfig::default();
        Self {
            client: Self::build_client(None, &config),
            proxy_config: None,
            request_config: config,
        }
    }

    fn build_client(proxy: Option<&ProxyConfig>, req_cfg: &RequestConfig) -> Client {
        let mut builder = Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .http1_title_case_headers()  // HTTP/1.1 首字母大写 (Accept, User-Agent, Host)
            // 显式设置默认 headers
            .default_headers({
                let mut headers = header::HeaderMap::new();
                headers.insert(
                    header::ACCEPT,
                    header::HeaderValue::from_static("*/*"),
                );
                headers
            });

        // User-Agent
        let ua = if req_cfg.user_agent.is_empty() {
            DEFAULT_UA
        } else {
            &req_cfg.user_agent
        };
        builder = builder.user_agent(ua);

        // 外部代理
        if let Some(cfg) = proxy {
            if !cfg.host.is_empty() && cfg.port > 0 {
                match cfg.to_reqwest_proxy() {
                    Ok(p) => {
                        println!("[Proxy] Using external proxy: {}:{}", cfg.host, cfg.port);
                        builder = builder.proxy(p);
                    }
                    Err(e) => {
                        eprintln!("[Proxy] Failed to configure proxy: {}", e);
                    }
                }
            }
        }

        builder.build().expect("Failed to create HTTP client")
    }

    fn set_proxy(&mut self, config: Option<ProxyConfig>) {
        self.proxy_config = config.clone();
        self.client = Self::build_client(config.as_ref(), &self.request_config);
    }

    fn set_request_config(&mut self, config: RequestConfig) {
        self.request_config = config;
        self.client = Self::build_client(self.proxy_config.as_ref(), &self.request_config);
    }

    fn get_client(&self) -> &Client {
        &self.client
    }

    fn get_proxy_config(&self) -> Option<ProxyConfig> {
        self.proxy_config.clone()
    }

    fn get_request_config(&self) -> RequestConfig {
        self.request_config.clone()
    }
}

/// 共享的应用状态（Clone 以支持 axum 0.8 State 提取）
#[derive(Clone)]
pub struct AppState {
    client: Arc<Mutex<DynamicClient>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(DynamicClient::new())),
        }
    }

    pub fn new_shared() -> Self {
        Self::new()
    }

    pub fn get_client(&self) -> Client {
        self.client.lock().unwrap().get_client().clone()
    }

    /// 获取当前请求配置（含自定义 headers）
    pub fn get_request_config(&self) -> RequestConfig {
        self.client.lock().unwrap().get_request_config()
    }

    pub fn set_proxy_config(&self, config: Option<ProxyConfig>) {
        self.client.lock().unwrap().set_proxy(config);
    }

    pub fn get_proxy_config(&self) -> Option<ProxyConfig> {
        self.client.lock().unwrap().get_proxy_config()
    }

    /// 设置请求配置（含 User-Agent 和自定义 headers）
    pub fn set_request_config(&self, config: RequestConfig) -> Result<(), String> {
        let errors = config.validate();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        self.client.lock().unwrap().set_request_config(config);
        Ok(())
    }
}

// ==================== Tauri Commands ====================

/// 设置代理配置
pub fn set_proxy_config(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    let config = if host.is_empty() || port == 0 {
        None
    } else {
        Some(ProxyConfig { host, port, username, password })
    };
    state.set_proxy_config(config.clone());
    match config {
        Some(c) => Ok(format!("代理已设置: {}:{}", c.host, c.port)),
        None => Ok("代理已清除".to_string()),
    }
}

/// 获取当前代理配置
pub fn get_proxy_config(
    state: tauri::State<'_, AppState>,
) -> Result<Option<ProxyConfig>, String> {
    Ok(state.get_proxy_config())
}

/// 设置请求配置（User-Agent + 自定义 Headers）
pub fn set_request_config(
    state: tauri::State<'_, AppState>,
    user_agent: String,
    custom_headers: HashMap<String, String>,
) -> Result<String, String> {
    let config = RequestConfig {
        user_agent,
        custom_headers,
    };
    state.set_request_config(config)?;
    Ok("请求配置已更新".to_string())
}

/// 获取当前请求配置
pub fn get_request_config(
    state: tauri::State<'_, AppState>,
) -> Result<RequestConfig, String> {
    Ok(state.get_request_config())
}

// ==================== 代理服务器 ====================

pub async fn start_proxy_server(state: AppState) -> (u16, broadcast::Sender<()>) {
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/{*path}", get(proxy_get_handler).post(proxy_post_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

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

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal(shutdown_rx))
            .await
            .expect("Proxy server error");
    });

    println!("[Proxy] API proxy ready on http://127.0.0.1:{}", port);
    (port, shutdown_tx)
}

async fn shutdown_signal(mut rx: broadcast::Receiver<()>) {
    let _ = rx.recv().await;
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "mode": "tauri-rust-proxy"
    }))
}

// ==================== 请求代理处理 ====================

async fn proxy_get_handler(
    Query(params): Query<HashMap<String, String>>,
    axum::extract::Path(path): axum::extract::Path<String>,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let client = state.get_client();
    let req_cfg = state.get_request_config();
    proxy_request(&client, "GET", &path, Some(&params), &req_cfg).await
}

async fn proxy_post_handler(
    axum::extract::Path(path): axum::extract::Path<String>,
    axum::extract::State(state): axum::extract::State<AppState>,
    body: String,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let params: HashMap<String, String> = serde_urlencoded::from_str(&body).unwrap_or_default();
    let client = state.get_client();
    let req_cfg = state.get_request_config();
    proxy_request(&client, "POST", &path, Some(&params), &req_cfg).await
}

async fn proxy_request(
    client: &Client,
    method: &str,
    path: &str,
    params: Option<&HashMap<String, String>>,
    req_cfg: &RequestConfig,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    let api_path = if path.starts_with("api/") {
        path.replacen("api/", "api/v1/", 1)
    } else {
        format!("api/v1/{}", path)
    };

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

    // 构建请求，注入自定义 headers（显式设置确保 HTTP/1.1 正确大小写）
    let mut req = match method {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };

    // 显式设置 Host（确保 HTTP/1.1 回退时大小写正确）
    req = req.header("Host", FOFA_HOST);

    // 应用自定义 headers
    for (name, value) in &req_cfg.custom_headers {
        req = req.header(name.as_str(), value.as_str());
    }

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) {
                if parsed.get("error").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let errmsg = parsed.get("errmsg").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let errcode = parsed.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
                    eprintln!("[Proxy] Response ERROR: status={}, errmsg={}, errcode={}", status, errmsg, errcode);
                } else {
                    let size = parsed.get("size").and_then(|v| v.as_i64()).unwrap_or(0);
                    let results = parsed.get("results").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    println!("[Proxy] Response OK: status={}, size={}, results={}", status, size, results);
                }
            } else {
                println!("[Proxy] Response: status={}, body_len={}", status, body.len());
            }
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
