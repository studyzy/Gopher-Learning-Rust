# 第16章：从零构建一个生产级后端

本章带你从 0 到 1 落地一个“可上线”的 Rust 后端服务，覆盖需求拆解、项目骨架、配置/日志、HTTP API、数据库/迁移、鉴权、异步任务、测试与 CI/CD、容器化与部署。对照 Go 的常见做法（gin/chi + gorm/sqlx + zap + wire），给出在 Rust 生态的等价实践（axum + sqlx + tracing + cargo features）。

目录
- 目标与需求拆解
- 工作区与项目骨架
- 配置与日志初始化
- HTTP API 与路由（axum）
- 数据库访问与迁移（sqlx + testcontainers）
- 鉴权与会话（JWT、提取器中间件）
- 业务分层与依赖注入思路
- 异步任务、Outbox 与计划任务
- 测试体系（单元/集成/E2E）
- 本地开发、CI/CD 与容器化
- 扩展方向与练习

——

## 16.1 目标与需求拆解

示例系统：User + Auth + Todo
- 用户注册/登录（邮箱+密码）
- JWT 鉴权，保护 /todos CRUD
- 指标/健康检查
- 数据库：PostgreSQL
- 配置：文件 + ENV + CLI
- 日志：JSON/pretty，可动态调级

——

## 16.2 工作区与项目骨架

工作区结构（monorepo）：
```
rust-backend/
├─ Cargo.toml              # [workspace]
├─ crates/
│  ├─ dto/                 # 共享 DTO/错误
│  ├─ core/                # 领域与服务逻辑
│  └─ infra/               # 数据库/外部客户端/存储实现
└─ services/
   └─ api/                 # HTTP 服务 (axum)
```

workspace Cargo.toml：
```toml
[workspace]
members = ["crates/dto", "crates/core", "crates/infra", "services/api"]

[workspace.dependencies]
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }
tokio = { version = "1", features = ["full"] }
axum = "0.7"
sqlx = { version = "0.7", default-features = false, features = ["runtime-tokio-rustls", "postgres", "macros", "migrate"] }
argon2 = "0.5"
jsonwebtoken = "9"
time = { version = "0.3", features = ["macros", "serde-human-readable"] }
dotenvy = "0.15"
figment = { version = "0.10", features = ["env", "toml"] }
validator = { version = "0.18", features = ["derive"] }
uuid = { version = "1", features = ["v4", "serde"] }
thiserror = "1"
```

——

## 16.3 配置与日志

services/api/src/config.rs：
```rust
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct ServerCfg { pub addr: String }

#[derive(Debug, Deserialize, Clone)]
pub struct DbCfg { pub url: String }

#[derive(Debug, Deserialize, Clone)]
pub struct JwtCfg {
    pub secret: String,
    pub exp_minutes: i64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LogCfg {
    pub json: bool,
    pub level: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppCfg { pub server: ServerCfg, pub db: DbCfg, pub jwt: JwtCfg, pub log: LogCfg }

pub fn load() -> anyhow::Result<AppCfg> {
    dotenvy::dotenv().ok();
    let cfg: AppCfg = figment::Figment::new()
        .merge(figment::providers::Toml::file("config/default.toml"))
        .merge(figment::providers::Env::prefixed("APP_").split("__"))
        .extract()?;
    Ok(cfg)
}
```

services/api/src/logging.rs：
```rust
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

pub fn init(json: bool, level: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| level.parse().unwrap_or_else(|_| EnvFilter::new("info")));
    let fmt_layer = if json {
        fmt::layer().with_target(false).json().boxed()
    } else {
        fmt::layer().with_target(true).pretty().boxed()
    };
    tracing_subscriber::registry().with(filter).with(fmt_layer).init();
}
```

config/default.toml：
```toml
[server]
addr = "0.0.0.0:8080"

[db]
url = "postgres://postgres:postgres@localhost:5432/app"

[jwt]
secret = "changeme-dev"
exp_minutes = 60

[log]
json = true
level = "info,sqlx=warn"
```

——

## 16.4 HTTP API 与路由（axum）

DTO（crates/dto/src/lib.rs）：
```rust
use serde::{Serialize, Deserialize};
use validator::Validate;
use uuid::Uuid;
use time::{OffsetDateTime, macros::format_description};

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterReq {
    #[validate(length(min = 3, max = 64))]
    pub email: String,
    #[validate(length(min = 8))]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResp { pub token: String }

#[derive(Debug, Deserialize)]
pub struct TodoCreate { pub title: String }

#[derive(Debug, Serialize)]
pub struct TodoView {
    pub id: Uuid,
    pub title: String,
    pub done: bool,
    pub created_at: String,
}

pub fn fmt_time(ts: OffsetDateTime) -> String {
    ts.format(&format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z")).unwrap()
}
```

服务入口（services/api/src/main.rs）：
```rust
mod config; mod logging; mod routes; mod state; mod auth;

use axum::Router;
use routes::mk_router;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = config::load()?;
    logging::init(cfg.log.json, &cfg.log.level);
    let app = mk_router(cfg).await?;
    let addr = app.state().unwrap().cfg.server.addr.parse().unwrap();
    tracing::info!(%addr, "listening");
    axum::Server::bind(&addr).serve(app.into_make_service()).await?;
    Ok(())
}
```

状态与依赖（services/api/src/state.rs）：
```rust
use std::sync::Arc;
use crate::config::AppCfg;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<AppCfg>,
    pub db: PgPool,
}

pub async fn build_state(cfg: AppCfg) -> anyhow::Result<AppState> {
    let db = PgPool::connect(&cfg.db.url).await?;
    sqlx::migrate!().run(&db).await?;
    Ok(AppState { cfg: Arc::new(cfg), db })
}
```

路由（services/api/src/routes.rs）：
```rust
use axum::{Router, routing::{post, get}, extract::State, Json};
use crate::{state::{build_state, AppState}, config::AppCfg, auth::{AuthLayer, Claims, login, register},};
use dto::{TodoCreate, TodoView};
use uuid::Uuid;
use time::OffsetDateTime;

pub async fn mk_router(cfg: AppCfg) -> anyhow::Result<Router> {
    let st = build_state(cfg).await?;
    let app = Router::new()
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/todos", post(create_todo).get(list_todos))
        .route("/healthz", get(health))
        .with_state(st.clone())
        .layer(AuthLayer::new(st.clone()));
    Ok(app)
}

async fn health() -> &'static str { "ok" }

async fn create_todo(
    State(st): State<AppState>,
    Claims { sub }: Claims,
    Json(req): Json<TodoCreate>,
) -> anyhow::Result<Json<TodoView>> {
    let rec = sqlx::query!(
        r#"insert into todos (id, user_id, title, done) values ($1, $2, $3, false) returning id, title, done, created_at"#,
        Uuid::new_v4(),
        sub,
        req.title
    ).fetch_one(&st.db).await?;
    let view = TodoView {
        id: rec.id,
        title: rec.title,
        done: rec.done,
        created_at: dto::fmt_time(rec.created_at.into()),
    };
    Ok(Json(view))
}

async fn list_todos(
    State(st): State<AppState>,
    Claims { sub }: Claims,
) -> anyhow::Result<Json<Vec<TodoView>>> {
    let rows = sqlx::query!(
        r#"select id, title, done, created_at from todos where user_id = $1 order by created_at desc"#,
        sub
    ).fetch_all(&st.db).await?;
    let items = rows.into_iter().map(|r| dto::TodoView {
        id: r.id, title: r.title, done: r.done, created_at: dto::fmt_time(r.created_at.into())
    }).collect();
    Ok(Json(items))
}
```

鉴权（services/api/src/auth.rs）：
```rust
use axum::{extract::State, Json};
use axum::http::{Request, StatusCode};
use axum::middleware::from_fn_with_state;
use axum::response::Response;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, Algorithm};
use serde::{Serialize, Deserialize};
use time::{OffsetDateTime, Duration};
use validator::Validate;
use crate::state::AppState;
use dto::{RegisterReq, AuthResp};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{SaltString, PasswordHash};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: uuid::Uuid,
    pub exp: i64,
}

pub async fn register(State(st): State<AppState>, Json(req): Json<RegisterReq>) -> Result<Json<AuthResp>, (StatusCode, String)> {
    if let Err(e) = req.validate() { return Err((StatusCode::BAD_REQUEST, e.to_string())); }
    let user_id = uuid::Uuid::new_v4();
    let salt = SaltString::generate(&mut rand::thread_rng());
    let hash = Argon2::default().hash_password(req.password.as_bytes(), &salt).unwrap().to_string();
    sqlx::query!(r#"insert into users (id, email, password_hash) values ($1, $2, $3)"#, user_id, req.email, hash)
        .execute(&st.db).await.map_err(internal)?;
    let token = issue_jwt(&st, user_id)?;
    Ok(Json(AuthResp{ token }))
}

#[derive(serde::Deserialize)]
pub struct LoginReq { pub email: String, pub password: String }

pub async fn login(State(st): State<AppState>, Json(req): Json<LoginReq>) -> Result<Json<AuthResp>, (StatusCode, String)> {
    let rec = sqlx::query!(r#"select id, password_hash from users where email = $1"#, req.email)
        .fetch_optional(&st.db).await.map_err(internal)?;
    let Some(rec) = rec else { return Err((StatusCode::UNAUTHORIZED, "invalid credentials".into())) };
    let parsed = PasswordHash::new(&rec.password_hash).map_err(internal)?;
    Argon2::default().verify_password(req.password.as_bytes(), &parsed).map_err(|_| (StatusCode::UNAUTHORIZED, "invalid credentials".into()))?;
    let token = issue_jwt(&st, rec.id)?;
    Ok(Json(AuthResp{ token }))
}

fn issue_jwt(st: &AppState, uid: uuid::Uuid) -> Result<String, (StatusCode, String)> {
    let exp = (OffsetDateTime::now_utc() + Duration::minutes(st.cfg.jwt.exp_minutes)).unix_timestamp();
    let claims = Claims { sub: uid, exp };
    let token = jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(st.cfg.jwt.secret.as_bytes()))
        .map_err(internal)?;
    Ok(token)
}

pub struct AuthLayer { st: AppState }
impl AuthLayer {
    pub fn new(st: AppState) -> tower::Layered<tower::util::Identity, tower::util::Stack<(), ()>> { tower::layer::util::Stack::new(); }
}

pub async fn auth_mw<B>(State(st): State<AppState>, req: Request<B>, next: axum::middleware::Next<B>) -> Result<Response, StatusCode> {
    // 开放路由直接放行
    let path = req.uri().path();
    if path.starts_with("/api/v1/auth/") || path == "/healthz" { return Ok(next.run(req).await); }
    // 解析 Authorization: Bearer
    let Some(auth) = req.headers().get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let token = auth.strip_prefix("Bearer ").ok_or(StatusCode::UNAUTHORIZED)?;
    let data = jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(st.cfg.jwt.secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    ).map_err(|_| StatusCode::UNAUTHORIZED)?;
    // 将 Claims 注入扩展，路由处理器提取
    let mut req = req;
    req.extensions_mut().insert(data.claims);
    Ok(next.run(req).await)
}

pub struct ClaimsExtractor;
impl<S> axum::extract::FromRequestParts<S> for super::auth::Claims
where S: Send + Sync {
    type Rejection = axum::http::StatusCode;
    fn from_request_parts(parts: &mut axum::http::request::Parts, _state: &S) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let claims = parts.extensions.get::<super::auth::Claims>().cloned();
        async move { claims.ok_or(axum::http::StatusCode::UNAUTHORIZED) }
    }
}

fn internal<E: std::fmt::Display>(e: E) -> (axum::http::StatusCode, String) {
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
```

注：
- 为简洁起见，AuthLayer 的类型声明省略，可直接用 router.layer(axum::middleware::from_fn_with_state(st.clone(), auth_mw)) 挂载中间件。
- 上面提供 Claims 提取器实现，处理器中以 Claims 参数注入。

在 routes 中挂中间件：
```rust
.layer(axum::middleware::from_fn_with_state(st.clone(), crate::auth::auth_mw))
```

——

## 16.5 数据库与迁移

迁移目录（services/api/migrations）：
```
0001_init.sql
```

0001_init.sql：
```sql
create table if not exists users (
  id uuid primary key,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists todos (
  id uuid primary key,
  user_id uuid not null references users(id),
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
```

启用 sqlx offline（可选）：
```bash
cargo install sqlx-cli
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app sqlx migrate run
```

——

## 16.6 业务分层与依赖注入

- domain：业务模型与接口
- repo：数据库访问（接口 + sqlx 实现）
- service：编排用例（事务、校验、事件）
- http：适配层（DTO/路由）

Rust 不常用运行时 DI 容器；更推荐通过构造函数传入依赖（显式注入），或使用 trait + 实现进行测试替换。

示例接口（crates/core/src/user.rs）：
```rust
#[async_trait::async_trait]
pub trait UserRepo: Send + Sync {
    async fn create(&self, email: &str, password_hash: &str) -> anyhow::Result<uuid::Uuid>;
    async fn find_by_email(&self, email: &str) -> anyhow::Result<Option<(uuid::Uuid, String)>>;
}
```

infra 提供 sqlx 实现并在 api 服务组装。

——

## 16.7 异步任务、Outbox 与计划任务

- 背景任务：Tokio 任务 + 有界通道（tokio::mpsc）或 schedule（tokio-cron-scheduler）
- Outbox：详见第 14 章。此处示例一个定期清理的任务

services/api/src/tasks.rs：
```rust
use tokio::time::{interval, Duration};
use crate::state::AppState;

pub async fn run_maintenance(st: AppState) {
    let mut tick = interval(Duration::from_secs(60));
    loop {
        tick.tick().await;
        if let Err(e) = sqlx::query!("delete from todos where title = ''").execute(&st.db).await {
            tracing::error!(err=?e, "maintenance failed");
        }
    }
}
```

main 中启动：
```rust
let st_bg = app.state().unwrap().clone();
tokio::spawn(async move { tasks::run_maintenance(st_bg).await; });
```

——

## 16.8 测试体系

- 单元测试：纯函数/服务层逻辑
- 集成测试：起一个 testcontainers 的 Postgres，跑迁移后对 API/Repo 进行真实测试
- E2E：用 reqwest 调起服务端口或使用 axum 的 Router 直接调用

集成测试示例（services/api/tests/api_spec.rs）：
```rust
use axum::Router;
use services_api::{routes::mk_router, config::AppCfg};

#[tokio::test]
async fn register_and_login() {
    let cfg = AppCfg {
        server: services_api::config::ServerCfg { addr: "127.0.0.1:0".into() },
        db: services_api::config::DbCfg { url: std::env::var("TEST_DATABASE_URL").unwrap() },
        jwt: services_api::config::JwtCfg { secret: "testsecret".into(), exp_minutes: 60 },
        log: services_api::config::LogCfg { json: false, level: "info".into() },
    };
    let app = mk_router(cfg).await.unwrap();
    // 使用 axum::body::Body 和 http::Request 构造请求，或启动临时服务端口后用 reqwest 调用
}
```

可使用 testcontainers-rs 创建临时 PG 容器并注入 TEST_DATABASE_URL。

——

## 16.9 本地开发、CI/CD 与容器化

Makefile/just：
```Makefile
run:
\tcargo run -p api

fmt:
\tcargo fmt --all

lint:
\tcargo clippy --all-targets --all-features -- -D warnings

test:
\tcargo test --workspace --all-features
```

Dockerfile（多阶段）：
```Dockerfile
FROM rust:1.80 as builder
WORKDIR /app
COPY . .
RUN cargo build --release -p api

FROM gcr.io/distroless/cc
WORKDIR /app
COPY --from=builder /app/target/release/api /app/api
ENV RUST_LOG=info
EXPOSE 8080
ENTRYPOINT ["/app/api"]
```

GitHub Actions（见第 12 章 CI 模板）。部署参见第 14 章 K8s 章节。

——

## 16.10 扩展与加固

- 观测性：tracing + OpenTelemetry，/metrics 暴露 Prometheus
- 安全：rate limit、CORS、JWT 刷新、密码策略、账号锁定
- 性能：连接池调优、零拷贝 bytes、缓存层（Redis）
- 可用性：优雅退出、超时/重试/熔断、DB 自动重连
- 可维护性：error boundary，统一错误响应模型

——

## 小结

你已经具备用 Rust 快速搭建生产级后端的“全链路能力”：从项目骨架、配置与日志，到 Web、数据库、鉴权、异步任务，再到测试与部署。将 Go 的经验（接口清晰、可观测性、稳定性治理）迁移到 Rust，只需在类型与并发模型上稍作心智转换。

练习
1) 为 /todos 增加完成/删除接口，并为 title 添加唯一约束与冲突处理。
2) 将密码哈希/验证封装为服务，并引入失败计数与锁定策略。
3) 引入 OpenAPI（utoipa 或 oapi-codegen）生成文档与客户端。
4) 使用 testcontainers-rs 为集成测试启动临时 Postgres。
5) 加入 outbox 表与后台投递任务，将“todo 创建事件”发送到 NATS 或 Kafka。