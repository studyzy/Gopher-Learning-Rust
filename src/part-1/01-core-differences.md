# 第1章：Go 与 Rust 的核心差异

> “理解差异是掌握精髓的第一步”

作为一名经验丰富的 Go 开发者，在踏入 Rust 世界的第一刻，你需要建立一张“认知地图”。这张地图将帮助你理解两种语言在**内存管理、并发模型、错误处理、包管理、类型系统**等核心领域的设计哲学与实现差异。

本章目标：  
✅ 建立 Go 程序员学习 Rust 的认知地图  
✅ 理解两者在核心领域的设计哲学差异  
✅ 通过代码对比快速掌握 Rust 的独特思维

---

## 1.1 内存管理：从 GC 到所有权

**概念对照：**
- **Go**：自动 GC，无需手动释放；通过逃逸分析决定堆/栈分配
- **Rust**：编译期所有权 + 借用检查，作用域结束自动释放；无 GC 暂停

**迁移心法：**  
把“何时释放”从运行时交给“谁拥有”在编译期确定；优先用不可变借用传参，减少所有权移动。

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

---

## 核心差异对比表

| **特性** | **Go** | **Rust** |
|------------|--------|----------|
| **内存管理** | 自动 GC | 所有权/借用检查 |
| **并发模型** | goroutine + channel | async/await + Future + Tokio |
| **错误处理** | error 接口 | Result<T, E> + `?` 运算符 |
| **包管理** | Go Modules | Cargo + Crates.io |
| **类型系统** | interface（duck typing） | trait + 泛型约束 |
| **性能特性** | GC 暂停，快速开发 | 零成本抽象，极致性能 |

---

## 迁移实践检查清单

✅ **内存管理边界**：明确跨线程共享是否需要 Arc/Mutex/RwLock  
✅ **错误处理策略**：库层使用 thiserror，应用层使用 anyhow + with_context  
✅ **并发模型选择**：Tokio 作为主执行器；分离阻塞与异步；合理设置通道容量  
✅ **构建系统**：使用 workspace + features 控制可选能力  
✅ **代码质量**：集成 fmt + clippy + test + bench + audit 到 CI 流程

---

## 学习建议

🎯 **理解核心理念**：第一章重点是认知差异。Go 开发者转 Rust，不要先急着上手框架，而是要彻底理解 Rust 的内存模型与类型系统。

🚀 **渐进式学习**：先掌握所有权和借用，再学习异步编程，最后在实际项目中练习。

📝 **动手实践**：每一个概念都要动手写代码验证，理解编译器的错误信息是学习 Rust 的重要环节。

