# 10. 并发模型（面向 Go 程序员）

本章从资深 Go 工程师的视角系统梳理 Rust 的并发模型。Rust 与 Go 的核心差异在于：Rust 无 GC，依赖编译期“所有权/借用/生命周期”与 Send/Sync 边界避免数据竞争；共享可变状态必须用同步原语或消息传递显式建模。你可以选择两条主线：

- 同步并发（std）：std::thread、Mutex/RwLock、std::sync::mpsc（或 crossbeam）
- 异步并发（Tokio 等）：async/await、tokio::spawn、tokio::sync::mpsc/oneshot、JoinSet、select!

迁移心法（Go → Rust）：
- goroutine ≈ tokio::spawn 的 task（轻量协程）或 std::thread::spawn 的 OS 线程；IO 密集优先 tokio，CPU 密集考虑 rayon 或 spawn_blocking。
- Rust channel 转移消息所有权，编译期保证无数据竞争。
- Send/Sync trait 边界替代“任何东西都能在 goroutine 里用”的自由度，换来编译期安全。

目录：
- std::thread vs goroutine
- tokio::spawn vs goroutine
- Mutex/RwLock vs sync.Mutex（含 RWMutex 对照）
- Channel 对照（std::sync::mpsc、tokio::sync::mpsc vs Go channel）
- 背压、取消、超时与 select
- 端到端示例与常见坑
- 速查表与小结

——

## 1. std::thread vs goroutine

Go 的 goroutine 是用户态协程，由运行时调度（GMP）；Rust 的 std::thread 是 OS 线程。开销差异显著：goroutine 可百万级；OS 线程通常几千以内。因此：
- CPU 密集短任务：用线程池（rayon）或少量 std::thread。
- IO 密集/海量并发：用 Tokio 的 task（见后文）。

对照示例（启动两个并发单元并等待）：

Go（goroutine + WaitGroup）：
```go
var wg sync.WaitGroup
wg.Add(2)
go func() {
    defer wg.Done()
    fmt.Println("A")
}()
go func() {
    defer wg.Done()
    fmt.Println("B")
}()
wg.Wait()
```

Rust（std::thread + JoinHandle）：
```rust
use std::thread;

fn main() {
    let h1 = thread::spawn(|| {
        println!("A");
    });
    let h2 = thread::spawn(|| {
        println!("B");
    });
    h1.join().unwrap();
    h2.join().unwrap();
}
```

在线程间共享可变数据（sync.Mutex 对照）：

Go：
```go
var mu sync.Mutex
count := 0
wg.Add(4)
for i := 0; i < 4; i++ {
    go func() {
        defer wg.Done()
        for j := 0; j < 10000; j++ {
            mu.Lock(); count++; mu.Unlock()
        }
    }()
}
wg.Wait()
fmt.Println(count)
```

Rust：
```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));
    let mut handles = Vec::new();
    for _ in 0..4 {
        let counter = Arc::clone(&counter);
        let h = thread::spawn(move || {
            for _ in 0..10_000 {
                *counter.lock().unwrap() += 1;
            }
        });
        handles.push(h);
    }
    for h in handles { h.join().unwrap(); }
    println!("count = {}", *counter.lock().unwrap()); // 40000
}
```

要点：
- Rust 中 Arc 相当于“可共享、线程安全的引用计数指针”。Mutex 返回 guard，Drop 自动解锁，等价于 Go 的 defer mu.Unlock()。
- Rust 的 Mutex 可能“中毒”（持锁线程 panic），后续 lock() 会 Err，提醒可能不一致；Go 没有中毒概念。

——

## 2. tokio::spawn vs goroutine

goroutine 更像 Tokio 的 task：轻量、调度友好、适合大并发 IO。区别：
- goroutine 即使阻塞 IO 也不一定卡住 M；Tokio task 必须使用异步 IO（.await），阻塞操作需 spawn_blocking。
- Rust async 返回 Future，惰性，不被 poll 不执行；goroutine 启动即运行。

并发 HTTP 示例（对照）：

Go：
```go
client := &http.Client{Timeout: 3 * time.Second}
urls := []string{"https://example.com", "https://httpbin.org/get"}
var wg sync.WaitGroup
wg.Add(len(urls))
for _, u := range urls {
    u := u
    go func() {
        defer wg.Done()
        resp, err := client.Get(u)
        if err != nil { log.Println("err:", err); return }
        io.Copy(io.Discard, resp.Body); resp.Body.Close()
        log.Println("ok:", u)
    }()
}
wg.Wait()
```

Rust（Tokio + reqwest）：
```rust
use reqwest::Client;
use tokio::task::JoinSet;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()?;
    let urls = vec!["https://example.com", "https://httpbin.org/get"];

    let mut set = JoinSet::new();
    for &u in &urls {
        let client = client.clone();
        let url = u.to_string();
        set.spawn(async move {
            let resp = client.get(&url).send().await?;
            let _ = resp.bytes().await?;
            anyhow::Ok(url)
        });
    }
    while let Some(res) = set.join_next().await {
        match res {
            Ok(Ok(url)) => println!("ok: {url}"),
            Ok(Err(e)) => eprintln!("task error: {e:?}"),
            Err(e) => eprintln!("join error: {e:?}"),
        }
    }
    Ok(())
}
```

阻塞/CPU 密集工作：
```rust
let handle = tokio::task::spawn_blocking(|| {
    // 压缩/哈希/阻塞文件 IO 等
    heavy_compute()
});
let result = handle.await?; // 不阻塞 Tokio reactor
```

——

## 3. Mutex/RwLock vs sync.Mutex/RWMutex

- Go sync.Mutex 轻量无“中毒”；Rust Mutex 可能因 panic 中毒，需要处理 Err。
- 读多写少：Go sync.RWMutex；Rust std::sync::RwLock 或 tokio::sync::RwLock（异步）。

Go（RWMutex）：
```go
var rw sync.RWMutex
cache := map[string]string{}
func Get(k string) (string, bool) {
    rw.RLock(); v, ok := cache[k]; rw.RUnlock(); return v, ok
}
func Set(k, v string) {
    rw.Lock(); cache[k] = v; rw.Unlock()
}
```

Rust（std：同步场景）：
```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

#[derive(Default)]
struct Cache { inner: RwLock<HashMap<String, String>> }

impl Cache {
    fn get(&self, k: &str) -> Option<String> {
        self.inner.read().unwrap().get(k).cloned()
    }
    fn set(&self, k: String, v: String) {
        self.inner.write().unwrap().insert(k, v);
    }
}

fn main() {
    let cache = Arc::new(Cache::default());
    let c1 = cache.clone();
    std::thread::spawn(move || { c1.set("a".into(), "1".into()); })
        .join().unwrap();
    println!("{:?}", cache.get("a"));
}
```

Rust（Tokio：异步场景）：
```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Default)]
struct Cache { inner: RwLock<HashMap<String, String>> }

#[tokio::main]
async fn main() {
    let cache = Arc::new(Cache::default());
    let c1 = cache.clone();
    tokio::spawn(async move {
        c1.inner.write().await.insert("a".into(), "1".into());
    }).await.unwrap();
    let v = cache.inner.read().await.get("a").cloned();
    println!("{v:?}");
}
```

注意：
- 异步任务中不要持有 std::Mutex/RwLock 的 guard 跨 await；改用 tokio::sync 锁或缩短临界区到 await 之前。

——

## 4. Channel 对照（std/tokio vs Go channel）

Go channel：语言级原语，支持无缓冲/带缓冲、关闭、select。Rust 有多实现：
- std::sync::mpsc：标准库，单接收端。学习/简单用途。
- tokio::sync::mpsc：异步有界队列，send/recv 是 async，天然背压。
- crossbeam::channel：同步高性能 MPMC，带 select! 宏，语义接近 Go。

基本对照

Go：
```go
ch := make(chan int, 2)
go func() {
    for i := 0; i < 5; i++ { ch <- i }
    close(ch)
}()
for v := range ch { fmt.Println(v) }
```

Rust（std mpsc）：
```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::channel(); // 无界，基于队列；sync_channel(cap) 为有界
    let t = thread::spawn(move || {
        for i in 0..5 { tx.send(i).unwrap(); }
    });
    for v in rx { println!("{v}"); }
    t.join().unwrap();
}
```

Rust（Tokio mpsc，异步）：
```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel::<i32>(2); // 有界，提供背压
    let tx2 = tx.clone();
    tokio::spawn(async move {
        for i in 0..5 {
            if tx.send(i).await.is_err() { break; }
        }
    });
    tokio::spawn(async move {
        for i in 100..105 { let _ = tx2.send(i).await; }
    });
    while let Some(v) = rx.recv().await {
        println!("{v}");
    }
}
```

关闭语义：
- Go：close(ch) 后，接收得到零值且 ok=false；发送 panic。
- Rust：Sender 或 Receiver 的所有克隆都 drop 即“关闭”。recv 返回 None/Err，send 返回 Err 携带未发送值。

select 对照：

Go：
```go
select {
case v := <-ch1:
    fmt.Println(v)
case ch2 <- 42:
    fmt.Println("sent")
case <-time.After(time.Second):
    fmt.Println("timeout")
}
```

Tokio：
```rust
use tokio::{select, time::{self, Duration}};

#[tokio::main]
async fn main() {
    let (tx2, mut ch2) = tokio::sync::mpsc::channel::<i32>(1);
    let mut sleep = time::sleep(Duration::from_secs(1));
    tokio::pin!(sleep);

    select! {
        _ = tx2.send(42) => {
            println!("sent");
        }
        _ = &mut sleep => {
            println!("timeout");
        }
        // 另一个分支示意：
        // Some(v) = ch1.recv() => { println!("{v}"); }
    }
}
```

crossbeam（接近 Go）：
```rust
use crossbeam::channel::{unbounded, select};

fn main() {
    let (s1, r1) = unbounded::<i32>();
    let (s2, r2) = unbounded::<i32>();
    std::thread::spawn(move || { s1.send(1).unwrap(); });
    std::thread::spawn(move || { s2.send(2).unwrap(); });

    select! {
        recv(r1) -> v => println!("r1: {:?}", v.unwrap()),
        recv(r2) -> v => println!("r2: {:?}", v.unwrap()),
        default => println!("no ready channel"),
    }
}
```

——

## 5. 背压、取消、超时与 select

- 背压：Tokio mpsc 的有界队列在满载时 send().await 会挂起，形成自然背压；Go 的带缓冲 channel 类似，无缓冲是同步点。
- 取消：Go 用 context.Context；Rust 常见：
  - tokio_util::sync::CancellationToken，任务里 select! 监听 token.cancelled()；
  - drop 对端让 recv 结束；
  - JoinHandle::abort 主动打断。
- 超时：Go 用 time.After/Context；Rust 用 tokio::time::timeout 或 sleep + select。

取消 + 超时示例（Tokio）：
```rust
use tokio::{select, time::{self, Duration}};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() {
    let token = CancellationToken::new();
    let child = token.child_token();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<i32>(1);

    let producer = tokio::spawn(async move {
        for i in 0..10 {
            tokio::time::sleep(Duration::from_millis(300)).await;
            select! {
                _ = child.cancelled() => break,
                _ = tx.send(i) => {}
            }
        }
    });

    let mut timeout = time::sleep(Duration::from_secs(1));
    tokio::pin!(timeout);

    loop {
        select! {
            _ = &mut timeout => {
                println!("timeout");
                token.cancel();
                break;
            }
            some = rx.recv() => {
                match some {
                    Some(v) => println!("{v}"),
                    None => break,
                }
            }
        }
    }
    let _ = producer.await;
}
```

——

## 6. 端到端示例：异步服务中的并发拓扑

目标：构建“URL 生产 → 并发下载 → 消费存储”的流水线，体现背压、并发控制与取消。示例采用“单接收端 + JoinSet 控制在飞任务”，避免误用 clone Receiver。

```rust
use anyhow::Result;
use reqwest::Client;
use tokio::{select, task::JoinSet, time::{sleep, Duration}};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
struct Item { url: String, body: bytes::Bytes }

#[tokio::main]
async fn main() -> Result<()> {
    let token = CancellationToken::new();
    let client = Client::builder().timeout(Duration::from_secs(5)).build()?;

    let (url_tx, mut url_rx) = mpsc::channel::<String>(100);
    let (item_tx, mut item_rx) = mpsc::channel::<Item>(100);

    // seed
    for u in ["https://example.com", "https://httpbin.org/get", "https://www.rust-lang.org/"] {
        url_tx.send(u.to_string()).await.unwrap();
    }
    drop(url_tx);

    // downloader：单接收端拉取 URL，使用 JoinSet 控制并发度（最多 64 个在飞）
    let downloader = {
        let child = token.child_token();
        let client = client.clone();
        let item_tx = item_tx.clone();
        tokio::spawn(async move {
            let mut set = JoinSet::new();
            while let Some(url) = url_rx.recv().await {
                let client = client.clone();
                let item_tx = item_tx.clone();
                let c = child.child_token();
                set.spawn(async move {
                    select! {
                        _ = c.cancelled() => Ok::<_, anyhow::Error>(()),
                        res = async {
                            let body = client.get(&url).send().await?.bytes().await?;
                            let _ = item_tx.send(Item{ url, body }).await;
                            Ok::<_, anyhow::Error>(())
                        } => res,
                    }
                });
                if set.len() >= 64 {
                    let _ = set.join_next().await;
                }
            }
            while set.len() > 0 { let _ = set.join_next().await; }
            Ok::<_, anyhow::Error>(())
        })
    };

    // consumer
    let consumer = tokio::spawn(async move {
        while let Some(item) = item_rx.recv().await {
            println!("got {}", item.url);
            // store(item).await?;
        }
        Ok::<_, anyhow::Error>(())
    });

    // 模拟 2s 后取消
    sleep(Duration::from_secs(2)).await;
    token.cancel();

    let _ = downloader.await?;
    let _ = consumer.await?;
    Ok(())
}
```

要点：
- mpsc::Receiver 不可 clone；由单任务驱动接收端，再以任务并发执行工作。
- 有界队列 + JoinSet 控制背压和在飞任务。
- 取消通过 CancellationToken 统一管理。

——

## 7. 常见坑与实践建议

- 不要在 async 任务中持有 std::Mutex/RwLock 的 guard 跨 await；用 tokio::sync 锁或缩短临界区。
- 运行时内做阻塞 IO/CPU 请用 spawn_blocking 或独立线程池；CPU 密集考虑 rayon。
- Clone 成本需明确：Arc/Client 等句柄 clone 廉价；大数据请用 Arc、Cow 或零拷贝 bytes。
- 处理锁“中毒”：lock().unwrap() 在 panic 后会 Err；可以 unwrap_or_else(|e| e.into_inner()) 继续，但需评估一致性。
- 选择 channel：
  - 异步：tokio::sync::mpsc/oneshot（首选）
  - 同步高性能：crossbeam::channel
  - 标准库 mpsc：教学/简单工具
- select 模式：Tokio 的 select! 分支为 Future；多通道可结合 tokio-stream，超时用 time::timeout。
- 结构化并发：优先 JoinSet、任务 scope，避免“野生任务”泄漏；必要时 JoinHandle::abort。

——

## 8. 速查表（给 Go 工程师）

- goroutine → tokio::spawn(task) 或 std::thread::spawn
- sync.Mutex/RWMutex → std::sync::Mutex/RwLock（同步）/ tokio::sync::Mutex/RwLock（异步）
- channel → tokio::sync::mpsc（异步），crossbeam::channel（同步高性能），std::sync::mpsc（基础）
- context.WithCancel/Timeout → CancellationToken、JoinHandle::abort、tokio::time::timeout
- select → tokio::select! / crossbeam::select!
- WaitGroup → JoinSet、futures::future::join_all、任务 scope

——

## 9. 小结

- Rust 将“并发安全”前置到编译期：所有权、Send/Sync 与类型系统帮助你避免数据竞争。
- 后台服务：IO 密集优先 Tokio + async/await；CPU 密集用 rayon 或 spawn_blocking。
- 使用有界通道与 JoinSet 管控并发度与背压，结合取消与超时构建稳健的生产级服务。

练习建议：
1) 用 tokio::sync::mpsc 实现有界工作队列，限制并发 64；
2) 为任务添加超时包装；
3) 对失败任务实现指数退避重试；
4) 引入 tracing 观测任务生命周期与背压点。