# 第9章：网络编程

本章面向有 Go 背景的读者，系统讲解 Rust 在服务端网络编程的常用技术栈与实践。从 TCP/UDP 到 HTTP/WebSocket/gRPC，再到超时重试、连接池、TLS、安全与性能调优，提供对照 Go 的思维迁移路径与可运行示例。

---

## 9.1 Go 到 Rust 的网络心智迁移

- Go 常用：
  - net、net/http、http2、grpc-go、context 控制超时与取消、http.Client 连接池与重试、io.Reader/Writer 流式处理。
- Rust 常用：
  - Tokio：异步运行时、异步 IO、定时器、通道。
  - hyper/axum：HTTP 栈（hyper 是底座，axum 是友好框架）。
  - reqwest：HTTP 客户端（基于 hyper），支持连接池、TLS、HTTP/2。
  - tonic：gRPC 框架（基于 hyper + tower）。
  - serde/serde_json、prost：序列化/反序列化。
  - socket2：底层 socket 细粒度控制（如 TCP_NODELAY、SO_REUSEPORT）。
- 映射关系：
  - Go net/http HandlerFunc ≈ axum handler（async fn），middleware 用 tower。
  - Go http.Client ≈ reqwest::Client。
  - Go context.WithTimeout ≈ tokio::time::timeout 或 tower 超时中间件。
  - Go bufio/bytes.Buffer ≈ bytes::BytesMut、tokio_util::codec。

---

## 9.2 基础：TCP Echo（Tokio）

```rust
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

async fn handle_connection(mut sock: TcpStream) -> std::io::Result<()> {
    let mut buf = vec![0u8; 4096];
    loop {
        let n = sock.read(&mut buf).await?;
        if n == 0 { break; }
        sock.write_all(&buf[..n]).await?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("0.0.0.0:9000").await?;
    loop {
        let (sock, addr) = listener.accept().await?;
        println!("accepted: {addr}");
        tokio::spawn(async move {
            if let Err(e) = handle_connection(sock).await {
                eprintln!("conn error: {e}");
            }
        });
    }
}
```

要点：
- 异步 read/write 返回 0 表示对端关闭。
- 避免在持锁范围内 .await（如共享状态），否则可能死锁。

---

## 9.3 UDP 示例：无连接 Echo

```rust
use tokio::net::UdpSocket;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let sock = UdpSocket::bind("0.0.0.0:9001").await?;
    let mut buf = [0u8; 1500];
    loop {
        let (n, peer) = sock.recv_from(&mut buf).await?;
        sock.send_to(&buf[..n], &peer).await?;
    }
}
```

要点：
- UDP 为无连接，注意 MTU 与分片。
- 需要应用层重传/有序性保障时，考虑 QUIC（quinn）或上层协议。

---

## 9.4 HTTP 客户端：reqwest

Cargo 依赖：
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "gzip", "brotli", "deflate", "rustls-tls", "http2"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

基础请求与 JSON：
```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct Post { userId: u32, id: u32, title: String, body: String }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = Client::builder()
        .http2_prior_knowledge(false)
        .pool_max_idle_per_host(8)
        .timeout(std::time::Duration::from_secs(3))
        .build()?;

    let p: Post = client
        .get("https://jsonplaceholder.typicode.com/posts/1")
        .send().await?
        .error_for_status()?
        .json().await?;

    println!("{p:#?}");
    Ok(())
}
```

超时、重试、退避（基于 tower-retry 简化示意）：
```toml
# Cargo.toml 片段
tower = { version = "0.5", features = ["util", "timeout"] }
```
```rust
use std::{time::Duration, sync::Arc};
use reqwest::Client;
use tokio::time::sleep;

async fn get_with_retry(client: Arc<Client>, url: &str, retries: u32) -> reqwest::Result<reqwest::Response> {
    let mut attempt = 0;
    loop {
        let resp = client.get(url).send().await;
        match resp {
            Ok(r) if r.status().is_success() => return Ok(r),
            Ok(r) if r.status().is_server_error() && attempt < retries => {}
            Err(e) if attempt < retries => {
                eprintln!("req error: {e}");
            }
            other => return other,
        }
        attempt += 1;
        let backoff = Duration::from_millis(100 * 2u64.saturating_pow(attempt));
        sleep(backoff.min(Duration::from_secs(2))).await;
    }
}
```

文件下载与流式处理（避免整块加载内存）：
```rust
use tokio::{fs::File, io::AsyncWriteExt};

async fn download_to_file(client: &Client, url: &str, path: &str) -> anyhow::Result<()> {
    let mut resp = client.get(url).send().await?.error_for_status()?;
    let mut file = File::create(path).await?;
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk).await?;
    }
    Ok(())
}
```

---

## 9.5 HTTP 服务端：axum（基于 hyper）

依赖：
```toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower = { version = "0.5", features = ["util", "timeout", "limit"] }
```

基础路由与 JSON：
```rust
use axum::{routing::{get, post}, Router, Json, extract::Path};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
struct Item { id: u64, name: String }

async fn get_item(Path(id): Path<u64>) -> Json<Item> {
    Json(Item { id, name: format!("item-{id}") })
}

async fn create_item(Json(mut it): Json<Item>) -> Json<Item> {
    it.name = it.name.to_uppercase();
    Json(it)
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/items/:id", get(get_item))
        .route("/items", post(create_item));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8088").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

中间件：超时与并发限流
```rust
use std::time::Duration;
use tower::{ServiceBuilder, timeout::TimeoutLayer, limit::ConcurrencyLimitLayer};
use axum::http::StatusCode;

#[tokio::main]
async fn main() {
    let middleware = ServiceBuilder::new()
        .layer(TimeoutLayer::new(Duration::from_secs(2)))
        .layer(ConcurrencyLimitLayer::new(256));

    let app = axum::Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .layer(middleware)
        .fallback(|| async { (StatusCode::NOT_FOUND, "not found") });

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8088").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 9.6 TLS：rustls 与 HTTPS

依赖：
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-rustls = "0.26"
rustls = { version = "0.23", default-features = false, features = ["ring", "tls12"] }
rcgen = "0.13"
```

示例：自签发证书的 HTTPS 服务器（示意，非生产）
```rust
use axum::{routing::get, Router};
use rustls::{Certificate, PrivateKey};
use tokio_rustls::TlsAcceptor;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 生成自签证书
    let cert = rcgen::generate_simple_self_signed(["localhost".into()])?;
    let cert_der = cert.serialize_der()?;
    let key_der = cert.get_key_pair().serialized_der().to_vec();

    let tls_config = std::sync::Arc::new({
        let certs = vec![Certificate(cert_der)];
        let key = PrivateKey(key_der);
        let cfg = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certs, key)?;
        cfg
    });

    let app = Router::new().route("/", get(|| async { "hello https" }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8443").await?;
    let acceptor = TlsAcceptor::from(tls_config);

    loop {
        let (stream, addr) = listener.accept().await?;
        let acceptor = acceptor.clone();
        let app = app.clone();
        tokio::spawn(async move {
            let Ok(tls_stream) = acceptor.accept(stream).await else { return };
            if let Err(e) = axum::serve(tokio::net::TcpListener::from_std(
                tls_stream.into_std().unwrap()
            ).unwrap(), app).await {
                eprintln!("serve err: {e}");
            }
        });
    }
}
```
提示：生产中直接使用 hyper-rustls 或在 axum::serve 前用 tls 接入层更为简洁。也可用 Nginx/Envoy 终止 TLS。

---

## 9.7 WebSocket：实时通信

依赖：
```toml
[dependencies]
axum = { version = "0.7", features = ["ws"] }
tokio = { version = "1", features = ["full"] }
```

示例：WebSocket 回显与广播
```rust
use axum::{extract::ws::{Message, WebSocketUpgrade, WebSocket}, response::IntoResponse, routing::get, Router};
use std::{sync::Arc};
use tokio::sync::broadcast;

async fn ws_handler(ws: WebSocketUpgrade, tx: Arc<broadcast::Sender<String>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, tx))
}

async fn handle_ws(mut ws: WebSocket, tx: Arc<broadcast::Sender<String>>) {
    let mut rx = tx.subscribe();
    // 读协程
    let txc = tx.clone();
    let mut ws_send = ws.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = ws.next().await {
            if let Message::Text(t) = msg {
                let _ = txc.send(t);
            }
        }
    });
    // 写协程
    while let Ok(msg) = rx.recv().await {
        if ws_send.send(Message::Text(msg)).await.is_err() {
            break;
        }
    }
}

#[tokio::main]
async fn main() {
    let (tx, _rx) = broadcast::channel::<String>(64);
    let app = Router::new().route("/ws", get({
        let tx = Arc::new(tx);
        move |ws| ws_handler(ws, tx.clone())
    }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 9.8 gRPC：tonic

依赖：
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
tonic = { version = "0.12", features = ["transport"] }
prost = "0.13"
```

proto（hello.proto）：
```proto
syntax = "proto3";
package hello;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }
```

生成代码与服务器：
```rust
// build.rs
fn main() {
    tonic_build::compile_protos("proto/hello.proto").unwrap();
}
```
```rust
// main.rs
use tonic::{transport::Server, Request, Response, Status};
pub mod hello { tonic::include_proto!("hello"); }
use hello::{greeter_server::{Greeter, GreeterServer}, HelloReply, HelloRequest};

#[derive(Default)]
struct MyGreeter;

#[tonic::async_trait]
impl Greeter for MyGreeter {
    async fn say_hello(&self, req: Request<HelloRequest>) -> Result<Response<HelloReply>, Status> {
        let name = req.into_inner().name;
        Ok(Response::new(HelloReply{ message: format!("Hello, {name}") }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "0.0.0.0:50051".parse()?;
    Server::builder()
        .add_service(GreeterServer::new(MyGreeter::default()))
        .serve(addr)
        .await?;
    Ok(())
}
```

---

## 9.9 序列化与数据格式

- JSON：serde/serde_json
- MessagePack：rmp-serde
- Protobuf：prost
- bincode：高效二进制序列化（不做 schema 演进）
- CSV：csv crate

示例：serde 自定义字段名与默认值
```rust
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
struct Cfg {
    #[serde(default = "def_port")]
    port: u16,
    #[serde(rename = "svcName")]
    service_name: String,
}
fn def_port() -> u16 { 8080 }
```

---

## 9.10 底层控制：socket2 与内核参数

当需要更细控制（如复用端口、禁用 Nagle）：
```toml
[dependencies]
socket2 = "0.5"
```
```rust
use socket2::{Socket, Domain, Type, Protocol};
use std::net::{SocketAddr, TcpListener as StdListener};

fn make_reuseport_listener(addr: SocketAddr) -> std::io::Result<StdListener> {
    let socket = Socket::new(Domain::for_address(addr), Type::STREAM, Some(Protocol::TCP))?;
    socket.set_reuse_address(true)?;
    #[cfg(target_os = "linux")]
    socket.set_reuse_port(true)?;
    socket.set_nodelay(true)?;
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    Ok(socket.into())
}
```

内核调优建议（Linux/macOS 参考）：
- somaxconn、tcp_tw_reuse/tcp_fin_timeout（Linux），rmem/wmem 上限。
- 调整文件描述符上限（ulimit -n）。
- 合理设置 TCP_NODELAY、SO_KEEPALIVE、接收/发送缓冲。
- 使用多实例监听配合 SO_REUSEPORT（Linux）。

---

## 9.11 零拷贝与缓冲策略

- bytes crate：高效字节缓冲，clone 为浅拷贝（引用计数）。
- BytesMut + freeze：可写缓冲到只读 Bytes 转换，避免复制。
- tokio_util::codec：帧化编解码。
```rust
use bytes::{BytesMut, BufMut};

fn build_packet() -> bytes::Bytes {
    let mut buf = BytesMut::with_capacity(1024);
    buf.put_u16(0xCAFE);
    buf.put_u32(123);
    buf.put_slice(b"hello");
    buf.freeze() // 零拷贝转为 Bytes
}
```

- mmap/发送文件：tokio::fs + sendfile（Linux 可通过 nix），或 hyper 的 Body::from(FileStream)。

---

## 9.12 背压、限流与队列

- tower::limit、Semaphore 控并发；
- mpsc/bounded 队列形成自然背压；
- leaky-bucket/token-bucket 限流（governor、ratelimit crate）。
示例：请求级限流（tower Layer）
```toml
governor = { version = "0.6", features = ["future-integration"] }
```
```rust
use std::{num::NonZeroU32, time::Duration};
use governor::{Quota, RateLimiter};
use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    let limiter = std::sync::Arc::new(RateLimiter::direct(Quota::per_second(NonZeroU32::new(100).unwrap())));
    let app = Router::new().route("/ping", get({
        let limiter = limiter.clone();
        move || {
            let limiter = limiter.clone();
            async move {
                limiter.until_ready().await;
                "pong"
            }
        }
    }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 9.13 可观测性与排障

- tracing：结构化日志 + Span/事件
- metrics：Prometheus 导出（metrics-exporter-prometheus）
- pprof：性能火焰图（pprof-rs）
- OpenTelemetry：分布式追踪（opentelemetry + tracing-opentelemetry）

示例：HTTP 请求日志
```rust
use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = Router::new()
        .route("/hello", get(|| async { "world" }))
        .layer(TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 9.14 安全最佳实践

- TLS 默认启用 rustls，禁用过时算法；验证证书。
- 严格解析与限制：请求体大小上限、头数量限制、路径正则校验。
- 统一错误响应，避免泄漏内部信息。
- 输入反序列化启用 deny unknown fields，避免宽松解析。
- 依赖审计：cargo audit、cargo deny。
- 最小权限：只暴露必须端口，容器内以非 root 运行。

---

## 9.15 性能调优清单

- 使用 release 构建：cargo build --release。
- 连接池复用：reqwest Client 复用；数据库连接池（bb8、deadpool）。
- 减少分配：预分配 BytesMut、复用 buffer。
- 避免阻塞：CPU 密集用 spawn_blocking；阻塞 IO 用专用线程池。
- 批量与向量化：聚合小包，减少系统调用次数。
- 压测与火焰图：wrk/hey + pprof + perf/dfx。

---

## 9.16 练习

1) 基于 axum 实现一个带超时、并发限流、请求体大小限制的 JSON API 服务，并记录 tracing 日志。
2) 使用 reqwest 实现一个带连接池、超时、重试与指数退避的下载器，要求支持断点续传（Range 请求）。
3) 使用 tokio + socket2 编写一个高并发 TCP 回显服务，开启 SO_REUSEPORT，并统计 QPS 与 P99 延迟。
4) 使用 tonic 编写一个 gRPC 服务与客户端，启用 TLS 并添加双向认证（mTLS）。

---

## 9.17 小结

- Rust 在网络编程中提供从底层 socket 到高层 HTTP/gRPC 的完整生态，结合 Tokio 实现高并发与低延迟。
- 相比 Go，Rust 需要更显式的 runtime、trait 与类型约束，但换来零成本抽象与更强的编译期保障。
- 工程落地关注：连接池与超时重试、TLS 与安全、背压与限流、可观测性与调优。持续以基准测试与火焰图驱动优化。