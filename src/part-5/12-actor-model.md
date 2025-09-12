# 第12章：Actor 模型

本章面向有 Go 后台经验的工程师，系统讲解 Rust 中的 Actor 模型设计与实践。Actor 模型适合管理复杂并发：每个 Actor 拥有私有状态，仅通过消息交互，避免共享可变数据带来的数据竞争与锁风暴；结合监督和重启策略，可构建高可用的服务拓扑。

对照心智（Go → Rust）：
- Go 常见写法：goroutine + channel + select 管理状态机和消息循环。
- Rust Actor：单任务/线程私有状态 + mpsc/broadcast/oneshot 通道 + select! 事件循环，类型系统帮助你定义严谨的协议和生命周期。
- 异步优先：Tokio 运行时下，Actor 即“一个持有状态的 async 任务”。

目录
- 概念与优势：为何用 Actor
- 最小 Actor：从零实现（std 与 Tokio 两种）
- 消息协议设计：命令、事件、请求-响应（oneshot）
- 监督与重启：如何在 Rust 中实现 supervisor tree
- 背压、限流、超时与取消
- 端到端示例：计数器服务与 Web 整合
- 常见坑与最佳实践
- 速查表与小结

——

## 1. 概念与优势

Actor 特点：
- 封装状态：状态仅在 Actor 任务内可变，外界只能发消息。
- 顺序一致性：同一 Actor 内部处理消息是单线程顺序的，减少锁需求。
- 可弹性伸缩：Actor 天生适合分片/分区（按 key 路由）。
- 监督树：失败隔离与重启恢复。

和 Go 的对照：
- Go 的“一个 goroutine + 一个 select 循环 + 多 channel”就是接近 Actor 的用法；Rust 的差异在于类型系统更严格、Send/Sync 边界清晰，更容易将协议固化为枚举与结构体。

——

## 2. 最小 Actor：从零实现

我们先给出最小可运行的 Tokio 异步 Actor（生产环境常用异步）。然后再给出 std 线程版。

Tokio 版（异步 Actor）：
```rust
use tokio::sync::{mpsc, oneshot};
use tokio::{select, time::{self, Duration}};

#[derive(Debug)]
enum Cmd {
    Inc(i64),
    Get(oneshot::Sender<i64>),
    Quit,
}

struct Counter {
    value: i64,
}

impl Counter {
    fn new() -> Self { Self { value: 0 } }

    async fn run(mut self, mut rx: mpsc::Receiver<Cmd>) {
        let mut tick = time::interval(Duration::from_secs(5));
        loop {
            select! {
                maybe = rx.recv() => {
                    match maybe {
                        Some(Cmd::Inc(n)) => { self.value += n; }
                        Some(Cmd::Get(reply)) => {
                            let _ = reply.send(self.value);
                        }
                        Some(Cmd::Quit) | None => {
                            // None 表示所有发送端都 drop，正常退出
                            break;
                        }
                    }
                }
                _ = tick.tick() => {
                    // 定时任务：可做持久化/日志/健康信号
                    // println!("tick value={}", self.value);
                }
            }
        }
        // 清理资源、刷盘等
    }
}

#[tokio::main]
async fn main() {
    let (tx, rx) = mpsc::channel(256);
    // 启动 Actor
    tokio::spawn(Counter::new().run(rx));

    // 与 Actor 交互
    tx.send(Cmd::Inc(10)).await.unwrap();
    tx.send(Cmd::Inc(5)).await.unwrap();

    let (reply_tx, reply_rx) = oneshot::channel();
    tx.send(Cmd::Get(reply_tx)).await.unwrap();
    let v = reply_rx.await.unwrap();
    println!("value = {v}");

    tx.send(Cmd::Quit).await.unwrap();
}
```

关键点：
- 消息协议用枚举清晰表达。Get 使用 oneshot 回复请求-响应。
- Actor 内部 select! 可同时处理消息与定时器/取消等事件。
- 退出条件：收到 Quit 或者接收端被关闭（rx.recv() 返回 None）。

std 线程版（同步 Actor）：
```rust
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

enum Cmd {
    Inc(i64),
    Get(mpsc::Sender<i64>),
    Quit,
}

struct Counter { value: i64 }

impl Counter {
    fn new() -> Self { Self { value: 0 } }

    fn run(mut self, rx: mpsc::Receiver<Cmd>) {
        loop {
            // 无 select：阻塞接收；可用 crossbeam::channel 提供 select!
            match rx.recv() {
                Ok(Cmd::Inc(n)) => self.value += n,
                Ok(Cmd::Get(reply)) => { let _ = reply.send(self.value); }
                Ok(Cmd::Quit) | Err(_) => break,
            }
        }
    }
}

fn main() {
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(|| {
        Counter::new().run(rx);
    });

    tx.send(Cmd::Inc(10)).unwrap();
    tx.send(Cmd::Inc(5)).unwrap();

    let (rtx, rrx) = mpsc::channel();
    tx.send(Cmd::Get(rtx)).unwrap();
    println!("value = {}", rrx.recv().unwrap());

    tx.send(Cmd::Quit).unwrap();
    h.join().unwrap();
}
```

若需要同步场景下的 select/timeout，推荐 crossbeam::channel 代替 std::sync::mpsc。

——

## 3. 消息协议设计

为避免“字符串指令 + 任意 payload”的脆弱设计，Rust 推荐：
- 用枚举表示命令类型。
- 对于需要回复的请求，嵌入 oneshot::Sender<T> 或者使用 Request/Response 对。

示例：请求-响应协议与错误传播
```rust
use tokio::sync::{mpsc, oneshot};

#[derive(Debug)]
struct User { id: u64, name: String }

#[derive(Debug)]
enum Cmd {
    Create { name: String, reply: oneshot::Sender<Result<User, String>> },
    Get { id: u64, reply: oneshot::Sender<Option<User>> },
}

```

- 错误通过 Result/Option 显式建模。
- 大对象传递考虑 Arc 或 bytes 零拷贝，避免频繁 clone。

——

## 4. 监督与重启（Supervisor）

Actor 的生产级实践必须考虑失败隔离与恢复。Rust 没有内建 supervisor tree，但可用“Supervisor 任务 + 子任务 JoinHandle”模式实现：

- 子 Actor 以返回 Result 的方式报告运行结果；panic 会体现在 JoinError。
- Supervisor 捕获退出原因，按策略决定重启、退避或升级为致命错误。

示例：简单监督器
```rust
use tokio::{task::JoinHandle, time::{sleep, Duration}};

async fn start_child() -> JoinHandle<anyhow::Result<()>> {
    tokio::spawn(async move {
        // 子 actor 事件循环...
        // anyhow::bail!("fatal") 以错误结束
        Ok(())
    })
}

#[tokio::main]
async fn main() {
    let mut backoff = 100u64; // ms
    loop {
        let handle = start_child().await;
        match handle.await {
            Ok(Ok(())) => {
                // 正常退出，不重启
                break;
            }
            Ok(Err(e)) => {
                eprintln!("child exited with error: {e}, restarting...");
            }
            Err(e) => {
                eprintln!("child panicked/join error: {e}, restarting...");
            }
        }
        sleep(Duration::from_millis(backoff)).await;
        backoff = (backoff * 2).min(5000);
    }
}
```

扩展：
- 多子 Actor：为每个子 Actor 维护重启计数器和时间窗口。
- 升级策略：超过阈值，向更上层汇报或终止进程。
- 有状态恢复：重启前持久化/快照状态，或从事件日志重建。

——

## 5. 背压、限流、超时与取消

- 背压：为 mpsc 通道设置有界容量。send().await 在满负载时挂起，保护下游。
- 限流：使用信号量/令牌桶控制并发在飞操作，例如 tokio::sync::Semaphore。
- 超时：tokio::time::timeout 包裹单次处理；全局可用 select + sleep。
- 取消：tokio_util::sync::CancellationToken 贯穿上下游；必要时 JoinHandle::abort。

示例：Actor 处理单条消息的超时与限流
```rust
use tokio::{select, time::{timeout, Duration}};
use tokio::sync::{Semaphore, mpsc};

struct Actor {
    sem: std::sync::Arc<Semaphore>,
}

impl Actor {
    async fn run(mut self, mut rx: mpsc::Receiver<String>) {
        while let Some(msg) = rx.recv().await {
            let permit = self.sem.clone().acquire_owned().await.unwrap();
            let fut = async move {
                // 处理 msg ...
                drop(permit); // 完成后释放
                Ok::<_, anyhow::Error>(())
            };
            match timeout(Duration::from_secs(2), fut).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => eprintln!("handle error: {e}"),
                Err(_) => eprintln!("handle timeout"),
            }
        }
    }
}
```

——

## 6. 端到端示例：Actor 化计数服务 + Web

实现一个 CounterService Actor，提供 HTTP API（GET /count, POST /inc），各组件间通过消息交互，演示请求-响应、背压与取消。

Cargo.toml 依赖提示：
- tokio = { version = "1", features = ["full"] }
- axum = "0.7"
- reqwest = "0.12"（如需客户端）
- anyhow, thiserror（错误处理）
- tokio-util（CancellationToken）

代码（单文件示例，便于理解）：
```rust
use std::net::SocketAddr;
use axum::{routing::{get, post}, Router, extract::State, Json};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
enum Cmd {
    Inc { n: i64, reply: oneshot::Sender<Result<i64, String>> },
    Get { reply: oneshot::Sender<i64> },
    Quit,
}

#[derive(Clone)]
struct CounterHandle {
    tx: mpsc::Sender<Cmd>,
}

impl CounterHandle {
    async fn inc(&self, n: i64) -> Result<i64, String> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(Cmd::Inc{ n, reply: tx }).await.map_err(|_| "actor closed".to_string())?;
        rx.await.map_err(|_| "actor dropped".to_string())?
    }
    async fn get(&self) -> Result<i64, String> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(Cmd::Get{ reply: tx }).await.map_err(|_| "actor closed".to_string())?;
        rx.await.map_err(|_| "actor dropped".to_string())
    }
    async fn quit(&self) {
        let _ = self.tx.send(Cmd::Quit).await;
    }
}

struct Counter {
    value: i64,
    cancel: CancellationToken,
}

impl Counter {
    fn new(cancel: CancellationToken) -> Self { Self { value: 0, cancel } }

    async fn run(mut self, mut rx: mpsc::Receiver<Cmd>) {
        loop {
            tokio::select! {
                _ = self.cancel.cancelled() => break,
                msg = rx.recv() => {
                    match msg {
                        Some(Cmd::Inc { n, reply }) => {
                            self.value += n;
                            let _ = reply.send(Ok(self.value));
                        }
                        Some(Cmd::Get { reply }) => {
                            let _ = reply.send(self.value);
                        }
                        Some(Cmd::Quit) | None => break,
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct IncReq { n: i64 }
#[derive(Serialize)]
struct CountResp { value: i64 }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cancel = CancellationToken::new();
    let (tx, rx) = mpsc::channel(1024);
    let handle = CounterHandle { tx: tx.clone() };

    // 启动 Actor
    let child = {
        let token = cancel.child_token();
        tokio::spawn(Counter::new(token).run(rx))
    };

    // Web 路由
    let app = Router::new()
        .route("/count", get({
            let h = handle.clone();
            move || {
                let h = h.clone();
                async move {
                    match h.get().await {
                        Ok(v) => Json(CountResp { value: v }),
                        Err(_) => Json(CountResp { value: -1 }),
                    }
                }
            }
        }))
        .route("/inc", post({
            let h = handle.clone();
            move |State(_): State<()>, Json(req): Json<IncReq>| {
                let h = h.clone();
                async move {
                    match h.inc(req.n).await {
                        Ok(v) => Json(CountResp { value: v }),
                        Err(_) => Json(CountResp { value: -1 }),
                    }
                }
            }
        }))
        .with_state(());

    let addr: SocketAddr = "127.0.0.1:3000".parse().unwrap();
    println!("listening on http://{addr}");
    let server = axum::Server::bind(&addr).serve(app.into_make_service());

    // 优雅退出：Ctrl+C 触发取消，等待 actor 结束
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            cancel.cancel();
            handle.quit().await;
        }
        res = server => {
            if let Err(e) = res { eprintln!("server error: {e}"); }
            cancel.cancel();
        }
    }
    let _ = child.await;
    Ok(())
}
```

重点说明：
- CounterHandle 封装消息发送与 oneshot 等待，外界“像调用函数一样”使用。
- Actor 持有 CancellationToken，可统一取消。
- Web handler 内不共享可变状态，避免锁竞争；所有写操作通过 Actor 串行化，保证一致性。
- 背压：mpsc 有界容量 1024，在高峰时起保护作用；可以结合限流中间件进一步防御。

——

## 7. 常见坑与最佳实践

- 不要把 std::Mutex/RwLock 的 guard 跨 await 持有；Actor 内部状态无需锁，外部用消息传递。
- mpsc::Receiver 不能 clone：如果需要多工作者消费，需要上层分发或采用 broadcast/分片路由。
- oneshot 回复要兜底：发送失败代表调用方已放弃结果，不要阻塞。
- 永远设计退出路径：Quit 消息、取消 token、通道关闭任一都应能优雅结束事件循环。
- 监督树：定义清晰的重启策略与退避，避免“疯狂重启风暴”。
- 序列化与大对象：在消息里传大对象前评估成本；优先 Arc<Bytes>/Arc<T> 或持句柄（ID）再由 Actor 内部拉取。
- 可观察性：为每个 Actor 打点（启动/退出/消息长度/处理时延）；使用 tracing 记录消息与因果链路。

——

## 8. 速查表（Go 工程师）

- goroutine + select → Tokio task + select! 循环（Actor）
- 多 channel → mpsc + oneshot（请求-响应），必要时 broadcast
- context.WithCancel → CancellationToken、JoinHandle::abort
- WaitGroup → JoinSet 或任务 scope
- 锁 → Actor 内部状态无需锁；跨 Actor 用消息；共享只读可用 Arc
- 超时 → tokio::time::timeout
- 限流 → tokio::sync::Semaphore 或 tower 中间件

——

## 9. 小结

- Actor 模型让“并发 + 一致性”更容易：状态封装、消息驱动、监督与背压构成可靠服务的四要素。
- 在 Rust 中实现 Actor 非常自然：使用枚举建模协议、mpsc/oneshot 传递消息、select! 统筹事件、CancellationToken 与 JoinSet 保障结构化并发。
- 当业务演进时，按 key 分片、按功能拆分 Actor，逐步形成有监督的服务拓扑。

练习建议
1) 将计数服务扩展为“按用户 ID 分片”的分区 Actor：哈希路由到不同分片，支持并发扩展。
2) 为 Actor 加入基于 tokio::sync::Semaphore 的并发限流，打点观测背压行为。
3) 实现一个 Supervisor：对子 Actor 的错误进行指数退避重启，并记录失败窗口。
4) 将消息协议迁移为 serde 序列化，准备跨进程通信（例如通过 NATS/Kafka）。