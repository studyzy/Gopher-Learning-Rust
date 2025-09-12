# 第8章：异步编程

本章从 Go 开发者视角系统介绍 Rust 异步：从 async/await 和 Future，到执行器（runtime），对照 goroutine/channel 的编程范式。结合 Tokio 实战网络 IO、任务并发、超时取消、限流与结构化并发，帮助你把 Go 的经验自然迁移到 Rust 服务端。

---

## 8.1 Go vs Rust 的并发/异步模型

- Go
  - goroutine：轻量线程，由 runtime 调度（M:N）。
  - channel：通信与同步抽象；select 多路复用。
  - GC 管理内存，逃逸分析决定分配位置。

- Rust
  - async/await：语法糖，编译为状态机；不自带 runtime。
  - Future：惰性计算，需执行器（Tokio/async-std）驱动。
  - 无 GC，依靠所有权/借用/Pin/Send/Sync 保证安全与性能。
  - 多种并发原语：JoinSet/JoinHandle，mpsc/oneshot 通道，Mutex/RwLock（异步版本），select! 宏等。

对照要点：
- goroutine = async 任务 + 执行器；Rust 需要显式选择 runtime（常用 Tokio）。
- Go 的通道内置于语言；Rust 由库提供（tokio::sync::mpsc/oneshot，futures::channel 等）。
- Rust 类型系统在编译期强约束 Send/Sync，减少数据竞争。

---

## 8.2 基础语法：async/await 与 Future

- async 函数返回的是 impl Future
```rust
async fn add(a: i32, b: i32) -> i32 {
    a + b
}

// 使用需要 .await（在异步上下文中）
async fn demo() {
    let x = add(1, 2).await;
    println!("{x}");
}
```

- async 块与 move
```rust
let v = 10;
let fut = async move {
    // 捕获 v 到状态机内部
    v * 2
};
```

- 在 Tokio 下运行
```rust
#[tokio::main]
async fn main() {
    let r = add(3, 4).await;
    println!("{r}");
}
```

---

## 8.3 Tokio 快速入门

- 选择 Tokio 的理由：成熟、生态广、性能佳（多 Reactor + work-stealing 调度器），IO/定时器/通道/同步原语齐全。
- Cargo 依赖（示例）
```toml
# Cargo.toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "gzip", "brotli", "deflate", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- 启动多线程 runtime
```rust
#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    println!("Tokio runtime started");
}
```

---

## 8.4 并发任务：spawn、join、select

- 并发启动任务
```rust
#[tokio::main]
async fn main() {
    let h1 = tokio::spawn(async { 1 + 2 });
    let h2 = tokio::spawn(async { 3 + 4 });
    let (r1, r2) = tokio::join!(h1, h2);
    println!("{:?} {:?}", r1.unwrap(), r2.unwrap());
}
```

- select 同步多个 Future（类似 Go 的 select）
```rust
use tokio::time::{sleep, Duration};
use tokio::select;

#[tokio::main]
async fn main() {
    let f1 = async { sleep(Duration::from_millis(200)).await; "A" };
    let f2 = async { sleep(Duration::from_millis(100)).await; "B" };

    select! {
        v = f1 => println!("first: {v}"),
        v = f2 => println!("first: {v}"),
    }
}
```

- JoinSet 管理动态任务集合（结构化并发）
```rust
use tokio::task::JoinSet;

#[tokio::main]
async fn main() {
    let mut set = JoinSet::new();
    for i in 0..5 {
        set.spawn(async move { i * i });
    }
    while let Some(res) = set.join_next().await {
        println!("done: {}", res.unwrap());
    }
}
```

---

## 8.5 通道：mpsc、oneshot、broadcast

- mpsc：多生产者单消费者
```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel::<String>(100);

    let tx2 = tx.clone();
    tokio::spawn(async move {
        tx.send("hello".into()).await.unwrap();
    });
    tokio::spawn(async move {
        tx2.send("world".into()).await.unwrap();
    });

    while let Some(msg) = rx.recv().await {
        println!("got: {msg}");
    }
}
```

- oneshot：一次性应答
```rust
use tokio::sync::oneshot;

#[tokio::main]
async fn main() {
    let (tx, rx) = oneshot::channel::<u32>();
    tokio::spawn(async move {
        tx.send(42).ok();
    });
    println!("answer={}", rx.await.unwrap());
}
```

- broadcast：发布订阅
```rust
use tokio::sync::broadcast;

#[tokio::main]
async fn main() {
    let (tx, _rx) = broadcast::channel::<&'static str>(16);
    let mut r1 = tx.subscribe();
    let mut r2 = tx.subscribe();

    tokio::spawn({
        let tx = tx.clone();
        async move {
            let _ = tx.send("news");
        }
    });

    println!("r1={}", r1.recv().await.unwrap());
    println!("r2={}", r2.recv().await.unwrap());
}
```

---

## 8.6 异步 IO：TCP/HTTP 实战

- TCP Echo 服务器（Tokio）
```rust
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8080").await?;
    loop {
        let (mut socket, addr) = listener.accept().await?;
        tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            loop {
                match socket.read(&mut buf).await {
                    Ok(0) => break, // closed
                    Ok(n) => {
                        if socket.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            println!("client {addr} closed");
        });
    }
}
```

- HTTP 客户端（reqwest）
```rust
use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct Ip { origin: String }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(5)).build()?;
    let resp = client.get("https://httpbin.org/ip").send().await?.error_for_status()?;
    let ip: Ip = resp.json().await?;
    println!("{ip:?}");
    Ok(())
}
```

- HTTP 服务端（axum）
```toml
# Cargo.toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
```
```rust
use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/hello", get(|| async { "world" }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## 8.7 超时、取消与背压

- 超时
```rust
use tokio::time::{timeout, Duration};

async fn slow() -> u32 { tokio::time::sleep(Duration::from_secs(2)).await; 7 }

#[tokio::main]
async fn main() {
    match timeout(Duration::from_millis(500), slow()).await {
        Ok(v) => println!("ok: {v}"),
        Err(_) => println!("timeout"),
    }
}
```

- 取消（任务中定期检查）
```rust
use tokio::{select, time::{sleep, Duration}};

async fn worker(mut cancel: tokio::sync::oneshot::Receiver<()>) {
    loop {
        select! {
            _ = &mut cancel => {
                println!("cancelled");
                break;
            }
            _ = sleep(Duration::from_millis(200)) => {
                println!("working...");
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let h = tokio::spawn(worker(rx));
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = tx.send(());
    let _ = h.await;
}
```

- 背压与限流（Semaphore）
```rust
use std::sync::Arc;
use tokio::sync::Semaphore;

#[tokio::main]
async fn main() {
    let sem = Arc::new(Semaphore::new(2)); // 并发上限 2
    let mut handles = Vec::new();

    for i in 0..6 {
        let permit = sem.clone().acquire_owned().await.unwrap();
        handles.push(tokio::spawn(async move {
            let _p = permit; // 持有期间占用额度
            println!("task {i} start");
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            println!("task {i} end");
        }));
    }

    for h in handles { let _ = h.await; }
}
```

---

## 8.8 Send/Sync、Pin 与 async 生命周期

- Send/Sync
  - Send：可在线程间移动（move）。
  - Sync：&T 可跨线程共享。
  - Tokio 多线程 runtime 中，spawn 的任务、闭包、返回值通常需要 Send + 'static。
```rust
async fn compute() -> i32 { 1 }
#[tokio::main(flavor = "multi_thread")]
async fn main() {
    tokio::spawn(async {
        // 该 async 块必须是 Send 的
        compute().await
    }).await.unwrap();
}
```

- Pin 的直觉：async/await 将局部变量捕获为状态机字段，包含自引用时需要固定内存位置（Pin）；绝大多数业务只需遵循“不要在未 Unpin 的 Future 上手写自引用”，使用库即可。

- 生命周期与 async
```rust
// 返回借用的异步函数通常需要把借用对象的生命周期提升到 'static 或在外层持有
async fn print_ref<'a>(s: &'a str) {
    println!("{s}");
}

#[tokio::main]
async fn main() {
    let s = String::from("hi");
    print_ref(&s).await; // s 活得足够久
}
```

---

## 8.9 错误处理与结构化并发

- anyhow/thiserror 搭配使用
```toml
# Cargo.toml
[dependencies]
anyhow = "1"
thiserror = "1"
```
```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum MyErr {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("bad code: {0}")]
    Bad(i32),
}
```

- 结构化并发：JoinSet/try_join! 确保子任务生命周期被父任务掌控
```rust
use tokio::{task::JoinSet, try_join};

async fn a() -> anyhow::Result<i32> { Ok(1) }
async fn b() -> anyhow::Result<i32> { Ok(2) }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 并行并且传播错误
    let (x, y) = try_join!(a(), b())?;
    println!("{x} {y}");

    let mut set = JoinSet::new();
    for i in 0..3 { set.spawn(async move { Ok::<_, anyhow::Error>(i*i) }); }
    while let Some(res) = set.join_next().await {
        println!("done: {}", res??);
    }
    Ok(())
}
```

---

## 8.10 async 与同步代码的边界

- 避免在 async 内进行阻塞 IO 或 CPU 密集计算；必要时使用 spawn_blocking
```rust
#[tokio::main]
async fn main() {
    let hash = tokio::task::spawn_blocking(|| {
        // 计算密集型任务
        blake3::hash(b"heavy").to_hex().to_string()
    }).await.unwrap();

    println!("{hash}");
}
```

- 从同步库迁移：优先寻找异步版本（reqwest vs ureq、tokio-postgres vs postgres 等），或用阻塞适配层（但注意吞吐）。

---

## 8.11 在服务端工程中的实践建议

- 选择 Tokio，并在 Cargo.toml 精准启用所需 features，减少二进制体积。
- 明确任务边界：对外层 API 提供取消/超时；内部任务定期检查取消。
- 使用 tracing 做结构化日志与追踪；为每个请求注入 Span。
```toml
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }
```
```rust
use tracing::{info, instrument};
use tracing_subscriber::EnvFilter;

#[instrument]
async fn handle(id: u64) {
    info!(%id, "handling");
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env()).init();
    handle(42).await;
}
```
- 资源控制：Semaphore/限流器、连接池（bb8、deadpool）、超时重试。
- 统一错误边界：错误类型实现 std::error::Error; 在服务端框架中统一转换为 HTTP 状态与 JSON 错误体。
- 性能调优：批量处理、减少分配、复用缓冲、合理协程数、避免镇流点（单点 Mutex/通道）。

---

## 8.12 从 Go 迁移的常见坑与心智模型

- 想当然把 goroutine 当做“无限免费”：Rust 的任务同样廉价但并非零成本，注意内存、上下文切换、队列拥塞。
- 在 async 上使用阻塞库导致整个执行器饥饿；应使用 async 版本或 spawn_blocking。
- 忽视 Send/Sync 边界：跨线程传递非 Send 类型会编译失败，尽早在类型上体现约束。
- 忽视生命周期与所有权：异步任务中 move 捕获可避免悬垂；对共享状态使用 Arc + 异步 Mutex/RwLock。
- 滥用 .await：在持锁范围内 .await 可能导致死锁，务必先释放锁再 .await。

---

## 8.13 练习

1) 使用 Tokio 实现一个带并发上限和超时的抓取器：
- 输入一组 URL，最大并发 10，每个请求 1 秒超时，返回成功的响应 body 长度之和。

2) 使用 axum 编写一个简单 KV 服务：
- PUT /kv/:key -> body 为值，存入 HashMap（使用 Arc<RwLock<...>>）
- GET /kv/:key -> 返回存储值
- 要求：添加 tracing 日志与请求超时中间件。

3) 使用 mpsc 通道实现工作池：
- 主线程生产任务，工人协程消费任务，限制并发 4，统计处理耗时。

---

## 8.14 小结

- Rust 的 async/await 基于 Future 与执行器，提供类似 Go 的高并发能力，同时借助类型系统保证跨线程安全。
- Tokio 生态完善，涵盖网络 IO、时间、同步原语、通道等，适合服务端开发。
- 工程实践围绕：结构化并发、超时取消、限流背压、错误边界与可观测性；避免阻塞与 Send/Sync 违规。
- 迁移心法：把 goroutine/chan 的直觉映射到 spawn/select/mpsc，再利用 Rust 的类型约束让系统在编译期更稳、更快。