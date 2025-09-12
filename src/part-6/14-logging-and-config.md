# 第14章：日志与配置

本章聚焦服务端最常用的两个工程基础：结构化日志与配置管理。对照 Go 的 zap/logrus + env/config 的实践，给出 Rust 生态的 tracing（结构化日志/链路）与多源配置（TOML/env/CLI）的一体化方案，包含动态级别、字段上下文、OpenTelemetry、SIGHUP 热重载与生产落地建议。

目录
- 为什么选 tracing：结构化日志与上下文传播
- 初始化方案：人类可读与 JSON 格式切换、动态日志级别
- 日志实践：字段化、Span/事件、错误链与敏感信息脱敏
- 配置管理：TOML + 环境变量 + CLI 合并、分环境配置
- 动态配置与热重载（SIGHUP + 文件监控）
- OpenTelemetry：分布式追踪与指标联动
- 与 Web/DB/异步框架集成示例（axum/reqwest/sqlx/tokio）
- 最佳实践清单与常见坑

——

## 1. 为什么选 tracing

tracing 是 Rust 事实标准的“结构化日志 + 诊断”框架，优势：
- 结构化字段：更像 Go 的 zap，避免 string 拼接。
- Span/事件：天然支持链路上下文，适合异步与多线程。
- 灵活输出：人类可读、JSON、远端采集（OTLP/Jaeger）自由切换。
- 与生态集成广：axum/hyper/tokio/sqlx/reqwest 等均有支持。

对照：
- Go 标配：zap + context + request-id 中间件。
- Rust：tracing + tracing-subscriber + 中间件（tower HTTP 层）实现等价甚至更强的关联日志与链路追踪。

——

## 2. 初始化方案：格式切换与动态级别

依赖：
```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json", "reload"] }
once_cell = "1"
```

初始化器（支持 pretty/JSON、EnvFilter、动态级别 reload）：
```rust
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt, reload};
use once_cell::sync::Lazy;

pub static RELOAD_HANDLE: Lazy<reload::Handle<EnvFilter, tracing_subscriber::Registry>> = Lazy::new(|| {
    // 先创建一个默认的 handle；真正的句柄在 init 时替换
    reload::Handle::new(EnvFilter::new("info"))
});

pub struct LogOptions {
    pub json: bool,
    pub default_level: String, // 例如 "info,hyper=warn,sqlx=warn"
}

pub fn init_logging(opts: LogOptions) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(opts.default_level));

    let (filter_layer, handle) = reload::Layer::new(filter);

    let fmt_layer = if opts.json {
        fmt::layer()
            .with_target(false)
            .json()
            .with_timer(fmt::time::UtcTime::rfc_3339())
            .boxed()
    } else {
        fmt::layer()
            .with_target(true)
            .pretty()
            .boxed()
    };

    let subscriber = tracing_subscriber::registry()
        .with(filter_layer)
        .with(fmt_layer);

    // 替换全局 RELOAD_HANDLE
    unsafe {
        // 安全说明：仅在 init 时写一次
        let handle_ptr = &*RELOAD_HANDLE as *const _ as *mut reload::Handle<_, _>;
        *handle_ptr = handle;
    }

    subscriber.init();
}

// 动态更新日志级别（如从管理接口/信号触发）
pub fn set_log_level(spec: &str) -> Result<(), String> {
    let filter = EnvFilter::try_new(spec).map_err(|e| e.to_string())?;
    RELOAD_HANDLE.modify(|current| *current = filter).map_err(|e| e.to_string())
}
```

使用：
```rust
fn main() {
    init_logging(LogOptions { json: false, default_level: "info,myapp=debug".into() });
    tracing::info!(event = "app_start", version = env!("CARGO_PKG_VERSION"));
    // ...
}
```

——

## 3. 日志实践：字段化、Span、错误链、脱敏

字段化日志：
```rust
use tracing::{info, warn, error};

fn handle_user(id: u64, name: &str) {
    info!(user.id = id, user.name = name, "handle user");
    if name.is_empty() {
        warn!(user.id = id, "empty name");
    }
}
```

Span 与上下文传播（异步最有价值）：
```rust
use tracing::{info_span, Instrument};

async fn process_order(order_id: String) {
    let span = info_span!("order", %order_id);
    async move {
        // 子任务会自动继承该 Span 的上下文
        do_step_a().await;
        do_step_b().await;
    }
    .instrument(span)
    .await;
}
```

错误链与 anyhow/thiserror 集成：
```toml
[dependencies]
anyhow = "1"
thiserror = "1"
tracing-error = "0.2"
```

```rust
use anyhow::{Context, Result};
use tracing::{error, instrument};

#[instrument(skip_all, fields(file = %path))]
fn read_config(path: &str) -> Result<String> {
    std::fs::read_to_string(path)
        .with_context(|| format!("read config failed: {path}"))
}

fn main() -> Result<()> {
    init_logging(LogOptions { json: true, default_level: "info".into() });
    if let Err(e) = read_config("config.toml") {
        error!(err = ?e, "startup failed");
        std::process::exit(1);
    }
    Ok(())
}
```

脱敏：对敏感字段进行 hash/屏蔽；在日志中统一用 masked 字段名：
```rust
let masked = format!("{}***", &token[..4.min(token.len())]);
tracing::info!(token.masked = %masked, "received token");
```

——

## 4. 配置管理：TOML + 环境变量 + CLI

依赖：
```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
figment = { version = "0.10", features = ["env", "toml"] }
clap = { version = "4", features = ["derive"] }
dotenvy = "0.15"
```

配置结构体与加载顺序（文件 -> 环境 -> CLI）：
```rust
use serde::Deserialize;
use clap::Parser;

#[derive(Debug, Deserialize, Clone)]
pub struct ServerCfg { pub addr: String }

#[derive(Debug, Deserialize, Clone)]
pub struct LogCfg {
    pub json: bool,
    pub level: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppCfg {
    pub server: ServerCfg,
    pub log: LogCfg,
}

#[derive(Parser, Debug)]
#[command(name = "myapp")]
pub struct Args {
    /// 覆盖日志级别，示例：info,myapp=debug,hyper=warn
    #[arg(long)]
    pub log_level: Option<String>,
    /// 配置文件路径（默认 config/default.toml）
    #[arg(long, default_value = "config/default.toml")]
    pub config: String,
}

pub fn load_config() -> anyhow::Result<(AppCfg, Args)> {
    dotenvy::dotenv().ok(); // 加载 .env
    let args = Args::parse();
    let cfg: AppCfg = figment::Figment::new()
        .merge(figment::providers::Toml::file(&args.config))
        .merge(figment::providers::Env::prefixed("APP_").split("__"))
        .extract()?;

    Ok((cfg, args))
}
```

优先级说明：
- 基础：TOML 文件（dev/staging/prod 各一份）
- 环境变量覆盖：APP_SERVER__ADDR=0.0.0.0:8080
- CLI 覆盖：--log-level debug

在 main 中使用：
```rust
fn main() -> anyhow::Result<()> {
    let (cfg, args) = load_config()?;
    let level = args.log_level.as_deref().unwrap_or(&cfg.log.level).to_string();
    init_logging(crate::LogOptions { json: cfg.log.json, default_level: level });
    tracing::info!(?cfg.server, "config loaded");
    Ok(())
}
```

——

## 5. 动态配置与热重载

目标：运行期动态调整日志级别、替换下游地址或开关功能。手段：
- 日志级别：使用 tracing-subscriber 的 reload handle。
- 配置文件热重载：通知信号（SIGHUP）或文件监控（notify crate）。
- 管理接口：暴露 HTTP 管理端点修改内存配置。

SIGHUP 热重载示例（仅日志级别）：
```rust
#[cfg(unix)]
async fn install_sighup() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut stream = signal(SignalKind::hangup()).expect("install sighup");
    while stream.recv().await.is_some() {
        // 从 ENV 或预设位置重新加载
        if let Ok(spec) = std::env::var("RUST_LOG") {
            let _ = crate::set_log_level(&spec);
            tracing::info!(%spec, "reloaded log level via SIGHUP");
        }
    }
}
```

文件监控（notify）示例思路：
- watch config/default.toml，变更后重新 parse 并替换内存配置（用 Arc<Swap> 或 RwLock）。

——

## 6. OpenTelemetry：分布式追踪与指标

依赖：
```toml
[dependencies]
tracing-opentelemetry = "0.23"
opentelemetry = { version = "0.23", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.16", features = ["http-proto", "reqwest-client"] }
```

初始化一个 OTLP 导出（将 Span 送往 Collector/Jaeger 等）：
```rust
use opentelemetry::sdk::{trace as sdktrace, Resource};
use opentelemetry::KeyValue;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub async fn init_tracing_with_otlp(service_name: &str) -> anyhow::Result<()> {
    let exporter = opentelemetry_otlp::new_exporter().http();
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_trace_config(sdktrace::Config::default().with_resource(Resource::new(vec![
            KeyValue::new("service.name", service_name.to_string()),
        ])))
        .with_exporter(exporter)
        .install_batch(opentelemetry::runtime::Tokio)?;

    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer().json())
        .with(otel_layer)
        .try_init()?;

    Ok(())
}

// 程序退出前 flush
pub fn shutdown_tracer() {
    opentelemetry::global::shutdown_tracer_provider();
}
```

注意：
- 与 JSON 本地日志可并存：一层本地 fmt，一层 OTLP 层。
- 在高 QPS 下注意出口缓冲与批量参数，避免对延迟影响。

——

## 7. 与 Web/DB/异步框架集成

HTTP（axum + tower-http 日志中间件）：
```toml
[dependencies]
axum = "0.7"
tower-http = { version = "0.5", features = ["trace"] }
```

```rust
use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;
use tracing::Level;

async fn hello() -> &'static str { "ok" }

#[tokio::main]
async fn main() {
    init_logging(LogOptions { json: true, default_level: "info,axum=info" });
    let app = Router::new()
        .route("/hello", get(hello))
        .layer(TraceLayer::new_for_http()
            .make_span_with(|req: &http::Request<_>| {
                tracing::span!(Level::INFO, "http", method = %req.method(), uri = %req.uri())
            })
            .on_response(|res: &http::Response<_>, _latency: std::time::Duration, _span: &tracing::Span| {
                tracing::info!(status = %res.status(), "response");
            })
        );

    let _ = axum::Server::bind(&"0.0.0.0:3000".parse().unwrap())
        .serve(app.into_make_service())
        .await;
}
```

数据库（sqlx）与 reqwest：
- sqlx 有内建日志，使用 EnvFilter 控制 "sqlx=info" 级别。
- reqwest/hyper 通过 "hyper=info" 控制网络层日志冗余。

Tokio：
- 不要在日志里打印过大的对象；使用字段摘要（len、hash、前缀）。

——

## 8. 最佳实践与常见坑

- 统一日志格式：本地 pretty，生产 JSON；通过配置或 env 切换。
- 字段命名约定：service、env、version、trace_id、span_id、request_id、user_id 等统一键名。
- 避免在热点路径频繁字符串构造；使用字段序列化（% 与 ?），并合理控制级别。
- 脱敏：token/password/secret/PII 等一律脱敏或禁打。
- 动态级别：提供管理接口或 SIGHUP 调整日志级别，便于现场诊断。
- 配置的来源与优先级明确：文件 < 环境 < CLI；对关键配置进行必填校验与默认值。
- 配置热更：对可能中断连接的配置（DB 连接串）采用“新建资源后原子替换”的方式，避免闪断。
- 追踪采样：在高流量系统启用概率采样或基于关键路由的采样策略，降低成本。
- 崩溃时最后一搏：在 panic hook/终止前 flush exporter 与日志缓冲。

——

## 9. 最小可复用模板

提供一套“开箱即用”的日志+配置骨架，便于复制到你的项目中：
- logging.rs：init_logging、set_log_level、init_tracing_with_otlp
- config.rs：AppCfg + load_config（TOML+ENV+CLI）
- main.rs：初始化顺序、SIGHUP、服务启动与优雅退出

main.rs 示例：
```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (cfg, args) = config::load_config()?;
    logging::init_logging(logging::LogOptions { json: cfg.log.json, default_level: args.log_level.clone().unwrap_or(cfg.log.level) });
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "service starting");

    #[cfg(unix)]
    tokio::spawn(logging::install_sighup());

    // TODO: init service, routes, db, metrics...

    // shutdown
    logging::shutdown_tracer();
    Ok(())
}
```

——

## 小结

- tracing 生态提供了 zap 等价甚至更强的结构化日志与链路管理能力，特别适合 Rust 的异步并发场景。
- 配置管理以 TOML 文件为基座，结合环境变量与命令行覆盖，形成清晰的优先级与审计路径。
- 动态日志级别、热重载、OTLP 输出让生产问题定位与回溯更可控。
- 将日志/配置模板化、标准化，是团队工程化落地的关键一步。

练习
1) 为你的服务接入 tracing JSON 日志与动态级别切换，添加 /admin/log-level 接口。
2) 引入 OpenTelemetry，打通到本地 Collector + Jaeger，观察跨服务链路。
3) 配置加载顺序：文件+ENV+CLI，模拟三层覆盖，并加入 SIGHUP 重载日志级别。
4) 为敏感字段实现统一脱敏工具，并在审查中强制使用。