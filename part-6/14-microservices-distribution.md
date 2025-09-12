# 14. 微服务与分布式（面向 Go 程序员）

本章聚焦 Rust 在微服务与分布式系统中的落地经验，对照 Go 常用栈（gin/grpc/zap/k8s），给出在 Rust 中等价或更稳健的工程化方案：服务契约与版本、通信协议与数据格式、服务发现与配置中心、可靠消息与幂等、跨服务一致性（SAGA/Outbox）、限流熔断重试、可观测性、安全与部署发布。

目录
- 服务契约与接口管理（API 定义、版本与向后兼容）
- 服务间通信：HTTP/REST、gRPC、消息总线（NATS/Kafka）
- 服务发现、配置中心与环境管理
- 可靠消息、幂等与 Exactly-once 的工程化
- 事务与一致性：SAGA、Outbox、补偿与重试
- 稳定性：限流、熔断、重试与退避
- 可观测性：tracing/metrics/logs 与跨服务链路
- 安全：鉴权、签名、mTLS、机密管理
- 部署与发布：Docker/K8s、健康探针与优雅退出
- 项目骨架与最佳实践

——

## 1. 服务契约与接口管理

Rust 推荐以“显式契约 + 代码生成/共享类型”管理接口：

- REST：OpenAPI（oapi-codegen 或 utoipa）生成路由/客户端 stub；共享 DTO crate。
- gRPC：prost + tonic 定义 proto，生成服务端/客户端代码。
- 版本策略：路径版本 v1/v2 或 Accept Header；优先后向兼容，新增字段走 Option。

共享 DTO crate（对照 Go 的 shared pkg）：
```toml
# crates/dto/Cargo.toml
[package]
name = "dto"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
```

```rust
// crates/dto/src/lib.rs
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateUserReq {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserResp {
    pub id: String,
    pub name: String,
    pub email: String,
    pub created_at: String,
}
```

——

## 2. 服务间通信

### 2.1 HTTP/REST（axum）

```toml
# Cargo.toml
[dependencies]
axum = "0.7"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tower = "0.5"
tower-http = { version = "0.5", features = ["trace", "cors"] }
```

```rust
use axum::{routing::{get, post}, Router, extract::State, Json};
use std::sync::Arc;
use dto::{CreateUserReq, UserResp};

#[derive(Clone)]
struct AppState {
    // repo/service handles...
}

async fn create_user(
    State(_st): State<Arc<AppState>>,
    Json(req): Json<CreateUserReq>,
) -> Json<UserResp> {
    // 假设创建成功
    Json(UserResp {
        id: "u_123".into(),
        name: req.name,
        email: req.email,
        created_at: "2025-01-01T00:00:00Z".into(),
    })
}

async fn get_health() -> &'static str { "ok" }

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState{});
    let app = Router::new()
        .route("/api/v1/users", post(create_user))
        .route("/healthz", get(get_health))
        .with_state(state);
    axum::Server::bind(&"0.0.0.0:8080".parse().unwrap())
        .serve(app.into_make_service())
        .await.unwrap();
}
```

建议：
- 使用 tower 中间件：TraceLayer、timeout、limit、buffer、compression、cors。
- JSON 编解码使用 serde，注意枚举/日期格式的稳定性。

### 2.2 gRPC（tonic）

```toml
[dependencies]
tonic = { version = "0.12", features = ["transport"] }
prost = "0.13"
tokio = { version = "1", features = ["full"] }

[build-dependencies]
tonic-build = "0.12"
```

build.rs：
```rust
fn main() {
    tonic_build::configure()
        .build_client(true)
        .build_server(true)
        .compile(&["proto/user.proto"], &["proto"])
        .unwrap();
}
```

user.proto：
```proto
syntax = "proto3";
package user.v1;

service UserService {
  rpc Create(CreateUserReq) returns (UserResp);
}

message CreateUserReq { string name = 1; string email = 2; }
message UserResp { string id = 1; string name = 2; string email = 3; string created_at = 4; }
```

服务端/客户端通过 tonic 生成的模块直接使用，建议开启 gzip、超时与拦截器做认证。

### 2.3 消息系统（NATS/Kafka）

- NATS：轻量 Pub/Sub、请求-响应；用于事件广播、即发即弃信号。
- Kafka：持久化日志，顺序分区与消费组；用于事件溯源、数据管道、可靠异步集成。

NATS（async-nats）示例：
```toml
[dependencies]
async-nats = "0.38"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = async_nats::connect("nats://127.0.0.1:4222").await?;
    let mut sub = client.subscribe("user.created").await?;
    tokio::spawn(async move {
        while let Some(msg) = sub.next().await {
            tracing::info!(subject = %msg.subject, payload = %String::from_utf8_lossy(&msg.payload));
        }
    });
    client.publish("user.created".into(), serde_json::to_vec(&serde_json::json!({
        "id": "u_123"
    }))?).await?;
    Ok(())
}
```

Kafka（rdkafka）建议使用 tokio-stream 或专用执行器处理背压与提交 offset；关键是幂等与重试策略（见下文）。

——

## 3. 服务发现、配置中心与环境管理

- 服务发现：K8s ClusterIP/DNS、Consul、etcd；gRPC/HTTP 客户端可按 DNS 轮询 + 超时重试。
- 配置中心：Vault/Consul/Etcd；或 GitOps（配置以文件形式随版本管理）。
- Rust 中推荐“文件+ENV+CLI”为主，密钥用 Vault/Secrets 管理并注入环境。

客户端负载均衡（简单 DNS 轮询 + 超时）：
```rust
use reqwest::Client;
use std::time::Duration;

fn mk_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(2))
        .pool_max_idle_per_host(8)
        .build().unwrap()
}
```

——

## 4. 可靠消息、幂等与 Exactly-once 的工程化

Exactly-once 往往是“业务层面”的幂等保证 + 至少一次投递的组合：

- 幂等键：以业务主键或幂等 token 去重。
- Outbox：本地事务内将事件写入 outbox 表，后台搬运器异步投递；失败重试不会重复影响下游（下游也要幂等）。
- 去重存储：Redis Set/Bitmap、DB 唯一键、幂等日志表。

示例：幂等处理接口（伪代码）
```rust
// 假设使用 Redis 记录一次性 token
async fn handle_payment(req: PaymentReq) -> Result<()> {
    if redis.set_nx(format!("idem:{}", req.id), "1", ttl=24h).await? == false {
        tracing::info!(%req.id, "duplicate request");
        return Ok(());
    }
    // 执行业务逻辑...
    // 失败时删除 key 允许重试，或保留并记录错误由人工干预
    Ok(())
}
```

——

## 5. 事务与一致性：SAGA 与 Outbox

- 跨服务强一致通常代价过高；SAGA 将一个大事务拆分为一系列本地事务与补偿动作。
- 本地库 Outbox：服务内的变更与事件写入一个事务，保证“状态改变”与“事件发出”要么一起成功要么可恢复。

Outbox 表结构示例：
```
outbox(id uuid pk, aggregate text, event_type text, payload jsonb, created_at timestamptz, dispatched bool default false)
```

搬运器任务（Tokio 定时）：
```rust
use tokio::time::{interval, Duration};

async fn run_outbox_dispatcher(db: Db, producer: KafkaProducer) {
    let mut tick = interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        if let Err(e) = dispatch_once(&db, &producer).await {
            tracing::error!(err=?e, "outbox dispatch failed");
        }
    }
}

async fn dispatch_once(db: &Db, producer: &KafkaProducer) -> anyhow::Result<()> {
    // 1) 取 N 条未分发事件（for update skip locked）
    // 2) 发送到 Kafka/NATS
    // 3) 标记 dispatched = true
    Ok(())
}
```

下游幂等消费：以 event id 或业务键作为去重键，重复消息直接忽略。

——

## 6. 稳定性：限流、熔断、重试与退避

Rust 生态可使用 tower 进行客户端/服务端弹性策略：

- 限流：tower::limit::RateLimitLayer（令牌桶）
- 超时：tower::timeout::TimeoutLayer
- 重试：tower::retry::RetryLayer（配合指数退避）
- 熔断：tower::buffer + 自定义失败计数，或使用外部库（如 metered、failsafe）

客户端示例（reqwest + tower）：
```toml
[dependencies]
tower = "0.5"
tower-http = { version = "0.5", features = ["trace"] }
backoff = "0.4"
```

思路：将 HTTP 请求包装成一个 Service 实现，叠加 Retry/Timeout/RateLimit layer。对于简单项目，也可手写带 backoff 的重试函数。

指数退避重试：
```rust
use backoff::{ExponentialBackoff, future::retry};
use anyhow::Result;
use reqwest::Client;

async fn call_with_retry(client: &Client, url: &str) -> Result<String> {
    let policy = ExponentialBackoff {
        max_elapsed_time: Some(std::time::Duration::from_secs(10)),
        ..Default::default()
    };
    retry(policy, || async {
        let resp = client.get(url).send().await?;
        if !resp.status().is_success() {
            Err(backoff::Error::transient(anyhow::anyhow!("status {}", resp.status())))
        } else {
            Ok(resp.text().await?)
        }
    }).await
}
```

——

## 7. 可观测性：跨服务链路

- tracing + OpenTelemetry：通过 HTTP header（W3C traceparent）或 gRPC metadata 传播上下文。
- 指标：请求时延直方图、错误率、队列长度；采样、降噪策略。

axum 集成跨服务 traceprop：
```toml
[dependencies]
opentelemetry = { version = "0.23", features = ["rt-tokio"] }
tracing-opentelemetry = "0.23"
opentelemetry-http = "0.10"
```

传播示例（简化思路）：
- 从入站请求头解析 Context，创建 Span；
- 出站请求通过 reqwest::RequestBuilder 注入 traceparent。

——

## 8. 安全：鉴权、签名、mTLS、机密管理

- 鉴权：JWT/OIDC；axum-extra 提供提取器，或自定义中间件校验。
- 请求签名：对接入方使用 HMAC 签名（timestamp + nonce + body）避免重放。
- mTLS：gRPC/HTTP 双向证书；reqwest 支持 rustls 客户端证书。
- 机密管理：不把密钥写入文件，使用 K8s Secret/Vault 注入，加载后进入内存并尽量不落盘日志。

reqwest 客户端证书（rustls）：
```toml
[dependencies]
reqwest = { version = "0.12", features = ["rustls-tls"] }
rustls = "0.23"
```

```rust
// 载入客户端证书与私钥，配置到 reqwest::ClientBuilder（略）
// 注意生产使用安全的密钥加载与权限控制
```

——

## 9. 部署与发布：Docker/K8s、健康探针与优雅退出

Docker 多阶段构建与最小镜像（参见第 12 章）。K8s 部署关键点：

- readinessProbe/livenessProbe：/readyz, /healthz
- 资源限制：requests/limits，防止抢占
- Pod 生命周期：preStop hook + 优雅退出（Ctrl+C 捕获，停止接收流量后再关闭）
- 滚动发布：maxSurge/maxUnavailable，注意数据库迁移的顺序与兼容

优雅退出（Tokio）：
```rust
#[tokio::main]
async fn main() {
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::broadcast::channel::<()>(1);

    // HTTP server
    let server = tokio::spawn({
        let mut rx = shutdown_rx.resubscribe();
        async move {
            axum::Server::bind(&"0.0.0.0:8080".parse().unwrap())
                .serve(axum::Router::new().into_make_service())
                .with_graceful_shutdown(async move { let _ = rx.recv().await; })
                .await
                .ok();
        }
    });

    tokio::signal::ctrl_c().await.unwrap();
    let _ = shutdown_tx.send(()); // 通知子任务
    let _ = server.await;
}
```

——

## 10. 项目骨架与最佳实践

推荐工作区结构：
```
my-ms/
├─ crates/
│  ├─ dto/              # 共享模型/协议
│  ├─ core/             # 领域与应用服务
│  └─ clients/          # 外部系统客户端（http/grpc/kafka）
├─ services/
│  ├─ user-api/         # HTTP/gRPC 服务
│  └─ billing-worker/   # 异步消费、定时任务、outbox dispatcher
└─ infra/
   ├─ migrations/
   ├─ deploy/           # Helm charts / K8s manifests
   └─ docker/
```

最佳实践清单：
- 契约优先：OpenAPI/proto 先行，生成代码与共享 DTO。
- 环境与配置：文件+ENV+CLI；Secrets 使用 K8s/Vault；区分 dev/staging/prod。
- 通信选择：接口（同步请求）优先 HTTP/gRPC；异步集成优先 Kafka/NATS。
- 可靠性：有界队列、背压、限流、超时、重试+退避、熔断。
- 一致性：SAGA+Outbox；上下游幂等键；幂等日志与死信队列。
- 可观测性：trace/metric/log 一致的字段与采样策略；跨服务传递 context。
- 安全：mTLS/JWT/签名；最小权限；密钥不落盘。
- 部署：最小镜像、健康探针、优雅退出、灰度与回滚。
- 文档与值班：Runbook/SLO/Error Budget；自动化告警。

——

## 小结

- Rust 在微服务与分布式领域具备生产可用的全链路能力：契约驱动、通信协议齐全、可靠消息与一致性策略完善、配合 tower/tracing 打造稳健的弹性与可观测。
- 与 Go 工程经验一一对照迁移：goroutine → tokio；zap → tracing；grpc 与消息中间件生态可平滑映射。
- 关键在于“设计先行”：契约与幂等、一致性协议与容错策略，辅以标准化部署与观测，构成可规模化的微服务体系。

练习
1) 以共享 dto crate + axum 搭建 user-api，并用 tonic 实现 user-grpc；两者共用领域服务。
2) 为订单流程设计 SAGA，结合 Outbox + Kafka；实现去重与重试退避。
3) 为出站 HTTP 客户端包一层 tower，加入 timeout/limit/retry，并在 tracing 中注入 traceparent。
4) 写一个 K8s 部署清单，包含资源限制、探针、优雅退出与滚动发布策略。