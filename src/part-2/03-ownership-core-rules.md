# 第3章：所有权核心规则

> “所有权系统是 Rust 的魂魄，也是它的独特之美”

本章专为 Go 程序员设计，帮助你理解 Rust 的内存模型与编译器检查。我们将通过与 Go 的 GC 模式对比，深入探讨**Move 语义、借用与可变性、生命周期标注**三大核心规则。

**学习目标：**
✅ 理解 Rust 的所有权系统如何在无 GC 的情况下保证内存安全  
✅ 掌握 Move 语义、借用规则和生命周期标注的实际应用  
✅ 学会在编译器错误提示下设计安全高效的 API

---

## 3.1 Move 语义：从共享到独占

这是 Go 和 Rust 在内存管理上的最大差异：

**在 Go 中：**
- 变量赋值或按值传参会发生浅拷贝（结构体字段逐个拷贝；切片/映射等为头部结构体拷贝，底层数组/哈希表共享）
- 你仍可在多个变量上使用同一底层数据（尤其切片/映射/指针），需要靠文档/规范避免并发数据竞争

**在 Rust 中：**
- 大多数类型（特别是拥有堆资源的类型，如 `String`, `Vec<T>`）在赋值或按值传参时发生 Move：所有权转移到新变量，旧变量不再可用（编译期阻止使用）
- `Copy` 类型（如 `i32`, `u64`, `f64`, `bool`, `char` 以及由 `Copy` 成员组成的简单 `struct`）按位拷贝，依旧可用

这种设计从根本上消除了“悬空引用”和“双重释放”的可能性。

示例：String 的 Move

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = s1;          // 所有权 move 到 s2，s1 失效
    // println!("{}", s1); // 编译错误：借用了已被 move 的值

    println!("{}", s2);   // OK
}
```

Copy 类型的拷贝

```rust
fn main() {
    let a: i32 = 42;
    let b = a;            // Copy，a 仍可用
    println!("{a}, {b}");
}
```

函数传参与返回时的 Move

```rust
fn takes(s: String) {      // 获取所有权
    println!("{}", s);
} // 这里 s 被 drop，释放内存

fn gives() -> String {     // 返回所有权
    String::from("data")
}

fn main() {
    let s = String::from("x");
    takes(s);              // s 移交，main 中 s 失效

    let t = gives();       // 拿回所有权
    println!("{t}");
}
```

对照 Go 心智模型：
- 类比 Go 中“切片头拷贝但共享底层数组”的共享风险，Rust 通过 Move/借用规则在编译期剥夺“悬空引用/并发写”的可能。
- 想复用数据？在 Rust 用借用（引用）或克隆（`.clone()`），由你显式选择成本与语义。

显式克隆

```rust
fn main() {
    let s1 = String::from("hi");
    let s2 = s1.clone();  // 深拷贝堆数据
    println!("{s1}, {s2}");
}
```

何时类型是 Copy？
- 满足 `Copy` trait（编译器自动或你派生 `#[derive(Copy, Clone)]`）；
- 不包含需要 Drop 的字段（例如 `String`、`Vec<T>` 都不是 Copy）。

---

## 3.2 借用：&T / &mut T 对照 Go 指针

Rust 将“共享”和“可变”分离为两类借用：
- `&T` 不可变借用：可同时存在多个，读共享，不能写。
- `&mut T` 可变借用：同时最多一个，独占访问，可读可写。

核心规则（编译器检查的别名/可变性法则）：
- 同一时刻，允许任意多个不可变引用，或恰好一个可变引用，二者不可并存。
- 引用不得悬空，使用范围受借用检查器与生命周期约束。

对照 Go：
- Go 指针 `*T` 没有静态借用规则，读写并发需靠互斥锁/约定来保证安全。
- Rust 在编译期就防住“读写竞态”，你通常用借用规则替代一部分锁的必要性；涉及跨线程仍需 `Send`/`Sync` 类型和并发原语。

示例：不可变借用可多用

```rust
fn main() {
    let s = String::from("hello");
    let r1 = &s;
    let r2 = &s;
    println!("{r1} {r2}"); // OK：多个 &T 共享读
}
```

示例：可变借用独占

```rust
fn main() {
    let mut s = String::from("hi");
    let r = &mut s;
    r.push_str(" there");   // 独占写
    println!("{r}");
    // println!("{s}");     // 编译错误：r 活跃期间不能用 s
}
```

可变与不可变引用不可同时存在

```rust
fn main() {
    let mut v = vec![1,2,3];
    let r1 = &v;               // 不可变借用
    // let r2 = &mut v;        // 编译错误：与 r1 冲突
    println!("{:?}", r1);
}
```

借用活跃范围与作用域尽量缩短

```rust
fn main() {
    let mut s = String::from("x");
    {
        let r = &mut s;    // 借用在此块内
        r.push('y');
    }                      // r 结束，借用释放
    println!("{s}");       // 现在可以再次借用或直接使用
}
```

切片与借用的交互（常见陷阱：可变操作会使引用失效）

```rust
fn main() {
    let mut v = vec![1,2,3];
    let first = &v[0];     // 不可变借用元素
    // v.push(4);          // 可能导致底层重分配，非法：同时持有借用与变更
    println!("{first}");
}
```

与 Go 的对比小结：
- Rust 借用规则强制你“先设计数据流，再写可变点”，避免隐式别名写入。
- 如果确需共享可变数据，使用 `RefCell<T>`（单线程运行时借用检查）或 `Mutex<T>/RwLock<T>`（跨线程同步）等智能指针类型。

---

## 3.3 生命周期标注：何时需要、何时可推断

生命周期是对“引用有效期”的静态描述。大多数情况下编译器可通过“省略规则”（elision）推断；当存在多个输入引用且返回值与其关系不唯一时，需要显式标注。

三个常见省略规则（函数/方法签名层面）：
1) 每个输入引用各自获得一个独立的隐式生命周期参数。
2) 若恰有一个输入引用，其生命周期赋给所有输出引用。
3) 方法签名中若有接收者 `&self` 或 `&mut self`，则 `self` 的生命周期赋给所有输出引用。

何时需要显式标注？
- 函数有多个引用参数，返回引用与哪一个参数关联不明确。
- 结构体中包含引用字段（必须标注）。
- 泛型/trait 边界中需要表达借用关系。

例：编译器可推断（单输入引用）

```rust
fn last_char(s: &str) -> Option<char> {
    s.chars().last()
} // 返回值与 s 同生存期，由规则 2 推断
```

例：需要标注（多输入引用，返回其一）

```rust
// 返回较长的那个切片，需告诉编译器：输出活得不比两个输入短
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() >= b.len() { a } else { b }
}
```

例：结构体保存引用

```rust
struct SliceRef<'a> {
    part: &'a str,
}

impl<'a> SliceRef<'a> {
    fn head(s: &'a str, n: usize) -> Self {
        SliceRef { part: &s[..n] }
    }
}
```

例：带方法接收者，常可省略返回标注（规则 3）

```rust
struct Buf {
    data: String,
}

impl Buf {
    fn as_str(&self) -> &str {  // 返回与 &self 绑定的生命周期
        &self.data
    }
}
```

例：与 Go 的对照思维
- Go 返回 `[]byte`/`string` 子切片常需注意“逃逸分析/底层数组生命周期”。Rust 通过生命周期让编译器证明：返回的引用不会比输入活得更久。
- 若你要“返回独立所有权的数据”（如在函数内构造 `String` 再返回），无需生命周期标注，因为不是引用：

```rust
fn make_string() -> String {
    "hello".to_string()
}
```

复杂签名中的生命周期与泛型约束

```rust
// 将 parser 应用于输入，返回输出与错误引用，二者都不超过输入生命周期
fn parse_with<'a, T, E, F>(input: &'a str, parser: F) -> Result<T, (&'a str, E)>
where
    F: Fn(&'a str) -> Result<(T, &'a str), E>,
{
    let (value, rest) = parser(input)?;
    Ok(value)
        .map(|v| v)
        .map_err(|e| (input, e))
}
```

提示：当你看到“cannot return reference to local variable”或“borrowed value does not live long enough”之类错误，检查：
- 返回了对局部临时的引用？改为返回所有权（如 `String` 或 `Vec`）。
- 多个输入引用如何约束到同一生命周期？是否需要 `'a` 参数。
- 是否可以缩短借用作用域，或引入中间块来结束借用。

---

## 3.4 常见迁移陷阱与实践建议

- 从 Go 的“随手取指针/共享切片”迁移到 Rust：优先不变性，延迟可变借用的产生与范围。
- 想共享可变状态？
  - 单线程：`RefCell<T>` 提供运行时借用检查（会 panic 而非编译错误）。
  - 多线程：`Arc<Mutex<T>>` 或 `Arc<RwLock<T>>`，配合 `Send/Sync` 约束。
- 避免不必要的 `.clone()`：先尝试以借用传递；确需跨作用域/线程或缓存副本时再克隆，成本更明确。
- 接口设计建议：
  - 读 API：`fn get(&self) -> &T` 或返回只读切片 `&[T]`/`&str`。
  - 写 API：尽量窄化借用窗口，如 `fn with_mut<R>(&mut self, f: impl FnOnce(&mut Inner) -> R) -> R`。
- 返回引用 vs 返回所有权：
  - 当返回的是输入数据的视图（切片/子串），返回引用并标生命周期。
  - 当返回的是新构造的数据或需要延长生命周期，返回所有权。

---

## 3.5 小练习

1) 修复以下代码的借用错误，使其既能打印长度又能追加内容：

```rust
fn main() {
    let mut s = String::from("go->rust");
    let len = s.len();
    // 在此处追加 "-ok" 并且保证可以打印 len 与 s
    println!("{len} {}", s);
}
```

参考思路：缩短不可变借用的作用域，或在追加前读取长度，或在独立块中进行可变借用。

2) 为函数添加合适的生命周期标注：

```rust
fn pick<'a>(a: &str, b: &str, first: bool) -> &str {
    if first { a } else { b }
}
```

提示：需要把返回值与输入之一绑定到同一 `'a`。

---

## 3.6 小结

- Move 语义：默认转移所有权，避免双重释放与悬空；`Copy` 类型按位拷贝。
- 借用规则：多读共享（`&T`），独占可变（`&mut T`），两者不并存；作用域越短越好。
- 生命周期：多数可省略；当存在多输入引用或在类型中存引用时需要标注。用它表达“输出不比输入活得更久”。

掌握这三板斧，你就具备用 Rust 在无 GC 的前提下写出内存/并发安全后端代码的基础。下一章将把这些规则带到集合类型与字符串处理的实战中。