# 1. Go 与 Rust 的核心差异

本章目标：  
- 建立 Go 程序员学习 Rust 的认知地图  
- 理解两者在 **内存管理、并发模型、错误处理、包管理、类型系统** 等方面的差异  
- 通过代码示例对照，帮助你快速抓住 Rust 的独特思维

常见坑：
- 共享可变数据：Rust 不允许同时存在多个可变引用；需用 &T（只读）、&mut T（独占可变）或 Arc/Mutex/RwLock 等并发原语
- 字符串/切片：&str 与 &[T] 是借用视图，修改需拥有权或可变借用
- 函数签名设计：尽量让所有权上移到构造/边界层，内部用借用降低拷贝与 move

实践指引：
- 跨线程共享：Arc<T> + Mutex<T>/RwLock<T>
- API 设计：默认以 &str、&[T] 接口；需要返回数据时返回拥有权（String/Vec<T>）
- 宏观策略：先写同步版通过借用/生命周期，再抽换成异步版

常见坑：
- 在 async 上下文中直接执行阻塞 IO（如 std::fs）：应使用 tokio::task::spawn_blocking 或专用阻塞线程池
- Send/Sync：跨线程共享的类型需满足 Send/Sync 约束，编译期会强制校验
- 背压与容量：mpsc 通道需合理设置缓冲区，避免生产者/消费者失衡

实践指引：
- IO 密集：优先 Tokio；CPU 密集：rayon 或多线程 + channel
- 控制流：select! 宏与 tokio::time::timeout 处理超时/取消
- 通道选择：tokio::sync::mpsc（异步）、broadcast（多播）、oneshot（单次）

常见坑：
- unwrap/expect 滥用导致崩溃：生产代码优先 ? 传播 + 自定义错误
- 错误类型繁杂：建议库用 thiserror 精确定义，应用边界用 anyhow 聚合

实践指引：
- 分层策略：领域错误用 thiserror；入口层 with_context 增强排障
- 日志：配合 tracing 记录 error 上下文（span/field）

实践指引：
- workspace 管理多 crate 单仓库；复用公共库、共享锁文件
- features 定义可选依赖（如 serde、runtime 选择），按需裁剪体积与功能
- 质量工具：cargo fmt、clippy、audit、udeps；发布用 cargo publish（库）或 cargo dist（应用分发）

---

## 1.1 内存管理

概念对照：
- Go：自动 GC，无需手动释放；通过逃逸分析决定堆/栈分配
- Rust：编译期所有权 + 借用检查，作用域结束自动释放；无 GC 暂停

迁移心法：
- 把“何时释放”从运行时交给“谁拥有”在编译期确定；优先用不可变借用传参，减少所有权移动

### Go
Go 使用垃圾回收（GC），开发者不用关心内存释放：

```go
package main

import "fmt"

func main() {
    data := make([]int, 0)
    for i := 0; i < 3; i++ {
        data = append(data, i)
    }
    fmt.Println(data) // [0 1 2]
    // Go 的 GC 会自动回收内存
}
```

### Rust
Rust 没有 GC，通过 **所有权规则** 和 **作用域** 自动管理内存：

```rust
fn main() {
    let mut data = Vec::new();
    for i in 0..3 {
        data.push(i);
    }
    println!("{:?}", data); // [0, 1, 2]
} // data 在作用域结束时自动释放
```

> **关键区别**：Go 依赖 GC，Rust 依赖所有权模型和编译器检查，零运行时开销。

---

## 1.2 并发模型

### Go
Go 的 CSP 并发模型：`goroutine + channel`。

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)

    go func() {
        ch <- 42
    }()

    val := <-ch
    fmt.Println(val) // 42

    time.Sleep(time.Second)
}
```

### Rust
Rust 的异步模型：`async/await + Future + Executor`。
常用 Tokio 作为运行时（执行器）：

```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::channel(1);

    tokio::spawn(async move {
        tx.send(42).await.unwrap();
    });

    if let Some(val) = rx.recv().await {
        println!("{}", val); // 42
    }
}
```

> **关键区别**：Go 并发模型天然内置；Rust 提供底层构建块（Future），需要运行时（Tokio/async-std）。

---

## 1.3 错误处理

### Go
Go 使用显式 `error`：

```go
package main

import (
    "errors"
    "fmt"
)

func doSomething(flag bool) (string, error) {
    if !flag {
        return "", errors.New("something went wrong")
    }
    return "ok", nil
}

func main() {
    result, err := doSomething(false)
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println(result)
    }
}
```

### Rust
Rust 使用 `Result<T, E>`，配合 `?` 运算符：

```rust
fn do_something(flag: bool) -> Result<String, String> {
    if !flag {
        Err("something went wrong".to_string())
    } else {
        Ok("ok".to_string())
    }
}

fn main() {
    match do_something(false) {
        Ok(res) => println!("{}", res),
        Err(err) => println!("Error: {}", err),
    }
}
```

或更简洁的写法：

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let res = do_something(true)?; // 自动传播错误
    println!("{}", res);
    Ok(())
}
```

> **关键区别**：Go 错误值是运行时检查，Rust 编译期强制处理错误，避免遗漏。

---

## 1.4 包管理

### Go
Go 使用 **Go Modules**：

```bash
go mod init example.com/project
go get github.com/gin-gonic/gin
```

### Rust
Rust 使用 **Cargo + Crates.io**：

```bash
cargo new project
cd project
```

`Cargo.toml` 配置依赖：

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

运行：

```bash
cargo run
```

> **关键区别**：Go modules 简洁；Cargo 功能更强大（依赖管理、特性开关、workspace）。

---

## 1.5 类型系统

### Go
Go 是鸭子类型（interface）：

```go
package main

import "fmt"

type Stringer interface {
    String() string
}

type User struct {
    Name string
}

func (u User) String() string {
    return u.Name
}

func printString(s Stringer) {
    fmt.Println(s.String())
}

func main() {
    u := User{Name: "Alice"}
    printString(u) // Alice
}
```

### Rust
Rust 使用 trait（类似接口，但更强大）：

```rust
trait Stringer {
    fn string(&self) -> String;
}

struct User {
    name: String,
}

impl Stringer for User {
    fn string(&self) -> String {
        self.name.clone()
    }
}

fn print_string<T: Stringer>(s: T) {
    println!("{}", s.string());
}

fn main() {
    let u = User { name: "Alice".to_string() };
    print_string(u); // Alice
}
```

还支持 **泛型 + trait bound**，比 Go 的接口更灵活。

进一步：trait object 与泛型单态化
- 泛型：编译期单态化，零抽象开销
- 动态分发：Box<dyn Trait> 运行时分发，类似 Go 接口值

常见坑：
- 返回/存储引用需要显式生命周期标注
- 过度模板化导致编译时间上升与代码膨胀

实践指引：
- 默认使用泛型获取性能；抽象稳定、需要插件式扩展时使用 dyn Trait
- 用 where 子句提升可读性；组合 trait bound 精准表达能力

---

## 1.6 性能与可观测性（新增）

- 性能：Rust 无 GC 暂停，适合低延迟/高可预测性；Go 具备稳定 TPS 与快速开发优势
- 可观测性：Go pprof 生态成熟；Rust 建议 tracing + metrics + pprof-rs/perf

实践指引：
- Rust：tracing_subscriber 做结构化日志；criterion 做基准测试
- 迁移：先对齐指标（P99 延迟、吞吐、内存峰值），再逐步替换模块

## 1.7 迁移清单（Checklist）
- 边界/所有权：明确跨线程共享是否需要 Arc/Mutex/RwLock
- 错误策略：库层 thiserror，应用层 anyhow + with_context
- 并发：Tokio 作为执行器；分离阻塞与异步；合理设置通道容量与限流
- 构建：workspace + features 控制可选能力
- 质量：fmt + clippy + test + bench + audit（CI 接入）

# 小结

| 特性         | Go                     | Rust                         |
|--------------|------------------------|------------------------------|
| 内存管理     | GC                     | 所有权 / 借用检查            |
| 并发模型     | goroutine + channel    | async/await + Future + Tokio |
| 错误处理     | error                  | Result<T, E> + `?`           |
| 包管理       | Go Modules             | Cargo + Crates.io            |
| 类型系统     | interface（duck typing） | trait + 泛型约束             |

> **学习建议**：第一章重点是认知差异。Go 开发者转 Rust，不要先急着上手框架，而是要彻底理解 Rust 的内存模型与类型系统。

