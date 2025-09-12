# 2. Rust 基础语法（对照 Go）

面向 Go 开发者的快速上手指南：通过并排对照的例子来理解 Rust 与 Go 在“变量与常量、控制流、集合、函数与闭包”等核心语法上的差异与共同点。每节都包含迁移注意点与实战建议。

---

## 2.1 变量与常量：let/mut vs var

在 Go 中，变量默认可变，常量用 `const`；在 Rust 中，变量默认不可变（immutability-by-default），需要显式 `mut` 才可变，常量用 `const`，此外还有只读“不可变绑定”的 `let` 与“只读但可重绑定”的 `shadowing` 概念。

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

迁移要点：
- Rust 推崇不可变性，有助于并发与可读性；需要变更状态时，用 `let mut`。
- `const` 在 Rust 中要求显式类型，且必须是编译期可求值的常量表达式。
- `shadowing` 与 Go 的“重新赋值”不同，shadowing 是“创建了新变量”，可改变类型和可变性。

---

## 2.2 控制流：if/match vs switch

Go 的 `if` 和 `switch` 简洁直接；Rust 的 `if` 是表达式（可返回值），`match` 类似模式匹配，比 `switch` 更强大、更严格（必须穷尽所有分支）。

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

迁移要点：
- `if` 可直接当表达式用，避免局部变量的临时赋值。
- `match` 要求穷举，能有效避免遗漏分支的 bug。
- 模式匹配可直接解构枚举、结构体、元组并配合守卫条件。

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

## 2.5 小结与实践建议

- 不可变优先：Rust 的 `let` 默认不可变，减少意外副作用；确需修改时再 `mut`。
- 表达式导向：`if`、`match` 都可以返回值，尽量用表达式构造结果而非临时变量。
- 借用与所有权：使用集合与闭包时，时刻留意借用（&/&mut）与移动（move）的边界，借用作用域尽量缩小。
- 错误处理预告：Rust 使用 `Result` 与 `?` 传播错误，下一章将详解（相对 Go 的 `error`）。

练习：
1) 将一个 Go 的 `switch` 多分支逻辑，改写为 Rust 的 `match`，包含区间与守卫。
2) 写一个 `Vec<i32>` 的函数，安全地取第 `i` 个元素（返回 `Option<i32>`），并在越界时不 panic。
3) 写一个返回闭包的函数，闭包内维护计数器，演示 `FnMut` 的使用，并在多次调用中累计。