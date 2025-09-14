# 第2章：Rust 基础语法（对照 Go）

> “语法是思想的载体，掌握语法就是掌握思维方式”

本章是 Go 开发者的 Rust 语法快速上手指南。我们将通过并排对照的例子，席助你理解 Rust 与 Go 在“**变量与常量、控制流、集合、函数与闭包**”等核心语法上的差异与共同点。

**本章特色：**
- 🔄 每个概念都提供 Go 与 Rust 的对比代码
- 📝 重点说明迁移注意点和实战建议
- 🎯 附带练习题帮助巩固理解

---

## 2.1 变量与常量：从可变优先到不可变优先

Rust 和 Go 在变量定义上有着根本性的哲学差异：

- **Go**：变量默认可变，常量用 `const`
- **Rust**：变量默认不可变（immutability-by-default），需要显式 `mut` 才可变

这种差异反映了两种语言的设计理念：Rust 强调安全性和可预测性，而 Go 则更注重开发效率。

- Go（变量与常量）

```go
package main

import "fmt"

const Pi = 3.14159

func main() {
    var x int = 10
    y := 20
    fmt.Println(x, y, Pi)

    x = 15 // 可变
    fmt.Println(x)

    // y 的类型在编译期已确定为 int，但依旧可修改值
    y = y + 1
    fmt.Println(y)
}
```

- Rust（不可变默认、mut、const、shadowing）

```rust
const PI: f64 = 3.14159;

fn main() {
    let x: i32 = 10;       // 默认不可变
    let mut y = 20;        // 显式可变
    println!("{x} {y} {PI}");

    // x = 15; // 编译错误：x 是不可变的
    y = y + 1;
    println!("{y}");

    // shadowing：创建一个新绑定，遮蔽旧的 x
    let x = 15;            // 新的 x（不可变），类型可改变
    println!("{x}");

    // 类型改变的 shadowing
    let x = "now a string";
    println!("{x}");
}
```

**迁移要点：**
- Rust 推崇不可变性，有助于并发与可读性；需要变更状态时，用 `let mut`
- `const` 在 Rust 中要求显式类型，且必须是编译期可求值的常量表达式
- `shadowing` 与 Go 的“重新赋值”不同，shadowing 是“创建了新变量”，可改变类型和可变性

---

## 2.2 控制流：从语句到表达式

Go 的 `if` 和 `switch` 简洁直接；Rust 的 `if` 是**表达式**（可返回值），`match` 类似模式匹配，比 `switch` 更强大、更严格（必须穷尽所有分支）。

这种“表达式导向”的设计哲学让 Rust 代码更加简洁和函数式。

- Go（if/switch）

```go
package main

import "fmt"

func sign(n int) string {
    if n > 0 {
        return "positive"
    } else if n < 0 {
        return "negative"
    }
    return "zero"
}

func weekday(n int) string {
    switch n {
    case 1, 2, 3, 4, 5:
        return "workday"
    case 6, 7:
        return "weekend"
    default:
        return "unknown"
    }
}

func main() {
    fmt.Println(sign(10))
    fmt.Println(sign(0))
    fmt.Println(weekday(6))
}
```

- Rust（if 是表达式，match 要求穷尽）

```rust
fn sign(n: i32) -> &'static str {
    if n > 0 {
        "positive"
    } else if n < 0 {
        "negative"
    } else {
        "zero"
    } // 注意：无分号，if 作为表达式返回值
}

fn weekday(n: u8) -> &'static str {
    match n {
        1..=5 => "workday",  // 区间匹配
        6 | 7 => "weekend",  // 多模式
        _ => "unknown",      // 必须穷尽模式
    }
}

fn main() {
    println!("{}", sign(10));
    println!("{}", sign(0));
    println!("{}", weekday(6));
}
```

更多 match 技巧（解构与守卫）：

```rust
#[derive(Debug)]
enum Message {
    Ping,
    Echo(String),
    Move { x: i32, y: i32 },
}

fn handle(msg: Message) -> String {
    match msg {
        Message::Ping => "pong".to_string(),
        Message::Echo(s) if s.len() < 10 => format!("short: {s}"), // 守卫
        Message::Echo(s) => format!("long: {s}"),
        Message::Move { x, y } => format!("move to {x},{y}"),
    }
}
```

**迁移要点：**
- `if` 可直接当表达式用，避免局部变量的临时赋值
- `match` 要求穷举，能有效避免遗漏分支的 bug
- 模式匹配可直接解构枚举、结构体、元组并配合守卫条件

---

## 2.3 集合：Vec/HashMap vs slice/map

Go 的切片 `[]T` 是动态数组，`map[K]V` 是哈希表；Rust 中“动态数组”是 `Vec<T>`，切片类型是 `&[T]`、`&mut [T]`，哈希表是 `std::collections::HashMap<K, V>`。最大区别是 Rust 的所有权与借用规则贯穿其 API 设计。

- Go（slice/map）

```go
package main

import "fmt"

func main() {
    // slice
    s := []int{1, 2, 3}
    s = append(s, 4)
    fmt.Println(len(s), cap(s), s)

    // map
    m := map[string]int{
        "a": 1,
        "b": 2,
    }
    m["c"] = 3
    v, ok := m["b"]
    fmt.Println(v, ok, len(m))
}
```

- Rust（Vec/HashMap）

```rust
use std::collections::HashMap;

fn main() {
    // Vec
    let mut v = vec![1, 2, 3];
    v.push(4);
    println!("len={} cap~? v={:?}", v.len(), v); // 无直接 cap()，可用 v.capacity()

    // 索引与遍历
    println!("v[0] = {}", v[0]); // 索引会 panic 越界
    for (i, x) in v.iter().enumerate() {
        println!("{i}: {x}");
    }

    // 切片（不可变/可变）
    let slice: &[i32] = &v[1..];       // 不可变切片
    let slice_mut: &mut [i32] = &mut v[1..3]; // 可变切片
    slice_mut[0] = 20;
    println!("after slice_mut: {:?}", v);

    // HashMap
    let mut m: HashMap<String, i32> = HashMap::new();
    m.insert("a".into(), 1);
    m.insert("b".into(), 2);
    m.entry("c".into()).or_insert(3);   // entry API
    if let Some(v) = m.get("b") {
        println!("b={v}");
    }
    println!("len={}", m.len());
}
```

关于所有权与借用的常见坑：

```rust
fn borrow_example() {
    let mut v = vec![1, 2, 3];

    // 不可变借用在作用域内禁止可变借用
    let first = &v[0];
    // v.push(4); // 编译错误：同时存在不可变引用 first 与可变借用 v.push
    println!("{first}");

    // 解决方案：缩小借用作用域
    let first = v[0];  // 拷贝 i32（Copy 类型）
    v.push(4);         // OK
    println!("{first} {:?}", v);
}
```

迁移要点：
- Vec 和切片的关系类似 Go 的动态数组与切片，但 Rust 有更严格的借用规则，防止数据竞争和悬垂引用。
- `HashMap` 常配合 `entry` API 做“若无则插入/更新”，避免两次查找。
- 越界索引会 panic，安全地访问可用 `v.get(i)` 返回 `Option<&T>`。

---

## 2.4 函数与闭包：Fn/FnMut/FnOnce vs Go 匿名函数

Go 的函数与闭包捕获变量语义简单；Rust 对闭包根据捕获语义分为三类 trait：`Fn`（仅借用不可变引用）、`FnMut`（可变借用）、`FnOnce`（按值捕获，可能移动所有权）。这使得并发与所有权语义更清晰，但初学时需要分辨。

- Go（函数与匿名函数）

```go
package main

import "fmt"

func add(a, b int) int {
    return a + b
}

func makeCounter() func() int {
    x := 0
    return func() int {
        x++
        return x
    }
}

func main() {
    fmt.Println(add(1, 2))
    counter := makeCounter()
    fmt.Println(counter()) // 1
    fmt.Println(counter()) // 2
}
```

- Rust（函数与闭包，自动推断捕获方式）

```rust
fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn make_counter() -> impl FnMut() -> i32 {
    let mut x = 0;
    move || {
        x += 1; // 需要可变状态 => FnMut
        x
    }
}

fn main() {
    println!("{}", add(1, 2));
    let mut counter = make_counter();
    println!("{}", counter()); // 1
    println!("{}", counter()); // 2
}
```

闭包三类 trait 的直观示例：

```rust
fn takes_fn<F: Fn()>(f: F) { f(); }
fn takes_fnmut<F: FnMut()>(mut f: F) { f(); }
fn takes_fnonce<F: FnOnce()>(f: F) { f(); }

fn main() {
    let s = String::from("hi");

    // 仅借用 => Fn
    let f1 = || println!("borrow: {}", s);
    takes_fn(f1);
    // f1 仍可用，因为只是借用
    takes_fn(|| println!("again: {}", s));

    let mut n = 0;
    // 可变借用 => FnMut
    let mut f2 = || { n += 1; println!("n={}", n); };
    takes_fnmut(&mut f2); // 以可变借用传入
    takes_fnmut(&mut f2);

    // 取得所有权 => FnOnce
    let s2 = String::from("owned");
    let f3 = move || println!("moved: {}", s2);
    takes_fnonce(f3);
    // f3 与 s2 均已被“消费”，此后不可再用 f3 或 s2
}
```

闭包与所有权在并发中的常见用法（跨线程 move）：

```rust
use std::thread;

fn main() {
    let data = vec![1, 2, 3];

    // 将 data 的所有权移动到新线程
    let handle = thread::spawn(move || {
        println!("in thread: {:?}", data);
        // 此处可安全使用 data
    });

    // 主线程不能再使用 data
    handle.join().unwrap();
}
```

迁移要点：
- 根据闭包内部是否修改捕获的环境变量、是否需要拿走所有权，编译器会自动推导 Fn/FnMut/FnOnce，但在 trait 约束中需要正确声明。
- 跨线程闭包通常需要 `move`，并确保捕获类型满足 `Send + 'static` 等约束。
- Rust 函数返回闭包时，多用 `impl Trait` 返回，例如 `impl FnMut()`。

---

---

## 2.5 代码规范与风格对照（Go ↔ Rust）

本节帮助 Go 开发者用“熟悉的感觉”写出规范的 Rust 代码：命名、布局、格式化、Lint、错误与日志、模块与 API 设计。

- 命名与基本风格
  - Go：导出标识符首字母大写（CamelCase）；私有小写开头。
  - Rust：模块/文件 snake_case；函数/变量 snake_case；结构体/枚举/trait 使用 PascalCase；常量与静态使用 UPPER_SNAKE_CASE。可见性用 `pub` 控制（默认私有）。
  - 建议：面向库的对外 API 命名稳定、简洁；内部细节保持私有，必要时使用 `pub(crate)` 细化可见范围。

- 文件与模块布局
  - Go：按包（目录）组织，`package foo`。
  - Rust：按模块组织：foo.rs 或 foo/mod.rs；同名目录代表子模块；对外通过 `pub mod foo;` 暴露。库入口为 src/lib.rs，二进制入口为 src/main.rs。
  - 建议：公共 API 放在 lib.rs 暴露；实现细节拆分到子模块；integration tests 放在 `tests/` 目录。

- 自动格式化（等价 gofmt）
  - 工具：`rustfmt`
  - 用法：
    - 一次性：`cargo fmt`
    - 检查（CI 友好）：`cargo fmt -- --check`
  - 配置：根目录可放 `rustfmt.toml`，但尽量遵循社区默认，减少团队分歧。

- Lint 静态检查（等价 golangci-lint 的一部分）
  - 工具：`clippy`
  - 用法：
    - 本地：`cargo clippy --all-targets --all-features`
    - 收敛为错误（CI 严格模式）：`cargo clippy -- -D warnings`
  - 典型建议：避免无意义的 clone、使用 `if let/while let` 简化匹配、优先 `Iterator` 风格、注意错误链传递。

- 错误处理规范（对照 Go 的 error）
  - Go：error 接口 + 包装。
  - Rust：`Result<T, E>` + `?` 传播；推荐库：
    - 应用层：`anyhow`（快速、动态错误，便于顶层兜底与上下文）
    - 库/SDK：`thiserror`（为公共错误类型派生 `Error` 实现，稳定 API）
  - 建议：
    - 业务函数返回 `Result<T, E>`，在边界添加上下文：`context("...")`（anyhow/eyre）。
    - 公共 crate 用 `thiserror` 定义稳态错误类型；避免将 `anyhow::Error` 暴露在公共 API。

- 日志与可观测性（对照 Go 的 log/slog/zerolog）
  - Rust 现代实践：`tracing`（结构化日志 + span）
  - 用法建议：
    - 应用：`tracing-subscriber` 初始化全局订阅者；使用 `info!`, `warn!`, `error!`，在关键路径打 `#[instrument]`。
    - 与异步结合良好，建议统一 JSON 输出，便于采集。

- 公共 API 设计（对照 Go 的接口导出）
  - 尽量暴露“最小必要”API；将内部模块保持私有。
  - 使用 trait 表达抽象，面向测试注入 mock（`mockall`）；对外可返回具体类型或 `impl Trait` 以隐藏实现细节。
  - 错误类型稳定、文档完整；避免导出需要频繁变更的内部结构体字段。

- Iterator 与集合风格（对照 Go 的 for/range）
  - Rust 鼓励链式迭代器：`iter().map(...).filter(...).collect::<Vec<_>>()`
  - 可读性优先：当链过长可拆变量；避免不必要的 `clone()`，优先借用。

- 注释与文档（对照 Go doc）
  - 文档注释：`///`（项目前），模块级 `//!`
  - 自动生成文档：`cargo doc --open`
  - 示例可写进文档注释中的代码块，测试时会作为 doctest 运行，有助保证示例可用。

- 配置与特性（features）
  - 使用 Cargo features 控制可选依赖与编译开关，避免在代码中大量 `cfg!` 分支。
  - 提供合理的默认特性组合（`default`），减少使用门槛。

- 常见风格陷阱（从 Go 转 Rust 易踩）
  - 过度使用可变：在 Rust 中不可变优先，缩小可变借用作用域。
  - 滥用 `clone()`：先考虑借用（`&T`/`&mut T`）；必要时再复制。
  - `unwrap()` 滥用：库代码禁用；应用入口处可兜底，但优先 `?` 与带上下文的错误。
  - 过深的模块可见性：不要到处 `pub`，用 `pub(crate)` 或保持私有。
  - 不一致的所有权语义：明确函数是否“借用还是接管”，命名与签名一起表达清楚（`&self`/`&mut self`/`self`）。

- 最小可执行规范清单（可加入 CI）
  - 格式化：`cargo fmt -- --check`
  - Lint：`cargo clippy --all-targets --all-features -- -D warnings`
  - 测试：`cargo test --all-features --all-targets`
  - 文档：`cargo doc -Zunstable-options --document-private-items`（可选）
  - 覆盖率：`cargo llvm-cov --workspace --all-features --html`（建议在 Linux CI）

---

## 章节总结

通过本章的学习，你应该已经掌握了 Rust 基础语法的核心理念：

✅ **不可变优先**：Rust 的 `let` 默认不可变，减少意外副作用；确需修改时再 `mut`

✅ **表达式导向**：`if`、`match` 都可以返回值，尽量用表达式构造结果而非临时变量

✅ **借用与所有权**：使用集合与闭包时，时刻留意借用（&/&mut）与移动（move）的边界，借用作用域尽量缩小

---

## 实践练习

📝 **练习 1：模式匹配转换**  
将一个 Go 的 `switch` 多分支逻辑，改写为 Rust 的 `match`，包含区间与守卫。

📝 **练习 2：安全的集合操作**  
写一个 `Vec<i32>` 的函数，安全地取第 `i` 个元素（返回 `Option<i32>`），并在越界时不 panic。

📝 **练习 3：闭包与所有权**  
写一个返回闭包的函数，闭包内维护计数器，演示 `FnMut` 的使用，并在多次调用中累计。

---

> 💡 **提示**：下一章我们将深入学习 Rust 最核心的概念——所有权与生命周期，这是理解 Rust 的关键。