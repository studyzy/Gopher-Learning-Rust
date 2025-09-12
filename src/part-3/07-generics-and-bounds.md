# 6. 泛型与约束

本章从 Go 开发者的视角，系统对比 Go(1.18+) 与 Rust 的泛型系统；并深入讲解 Rust 的 trait bound、where 子句、关联类型、泛型与生命周期的交互、以及“零成本抽象”的工程实践。配套完整、可运行的代码示例，帮助你将 Go 思维自然迁移到 Rust。

---

## 6.1 Rust 泛型 vs Go 1.18+ 泛型

- 相同点
  - 都能为函数与类型提供参数化能力，减少重复代码。
  - 都可通过“约束/接口”限制类型能力：Go 使用 interface+type set（如 ~int | ~string | constraints.Ordered），Rust 使用 trait bound（T: Trait）。
  - 编译期检查与单态化（monomorphization）：
    - Go：泛型函数/类型在使用时会进行实例化，编译器对每个具体类型生成专用代码（具体细节依实现）。
    - Rust：明确采用单态化（Monomorphization），为每个具体类型生成“专用机器码”，常带来“零成本抽象”。

- 不同点（对 Go 开发者很关键）
  - 约束表达方式：
    - Go：interface + type set（可并集、~底层类型匹配），强调“方法集”和“可比较性（comparable）”等。
    - Rust：trait 是“行为契约”，偏向“能力”，没有 type set 概念（但可用 trait 组合、特化/覆盖实现、泛型常量等手段达到表达力）。
  - 接口实现方式：
    - Go：隐式实现（只要方法集满足 interface 即可），带来解耦与灵活。
    - Rust：显式实现 impl Trait for Type，更可控，错误更早显式暴露；配合 orphan rule 控制实现孤儿规则。
  - 关联类型 vs Go 的“泛型+方法”：
    - Rust trait 支持“关联类型（associated type）”，可避免泛型层层传递，使接口更聚焦。
  - 编译期能力：
    - Rust：const generics（常量泛型）、高级 trait 系统（自动推导、where 子句、特质对象与静态分发/动态分发选择）。
  - 生命周期与所有权：
    - Go：GC 管理内存；泛型几乎不涉及生命周期问题。
    - Rust：泛型常与生命周期 bound 一起出现（如 T: 'a），对性能与内存安全更友好，但需要多一点思维成本。

---

## 6.2 Rust 基础泛型语法

- 泛型函数
```rust
fn identity<T>(x: T) -> T {
    x
}

fn main() {
    let a = identity(42);
    let b = identity(String::from("rust"));
    println!("{a}, {b}");
}
```

- 泛型结构体与 impl
```rust
struct Pair<T> {
    left: T,
    right: T,
}

impl<T> Pair<T> {
    fn new(left: T, right: T) -> Self { Self { left, right } }
    fn left(self) -> T { self.left }
}
```

- 多类型参数
```rust
struct MapEntry<K, V> {
    key: K,
    value: V,
}
```

与 Go 的对照（简化）：
```go
func Identity[T any](x T) T {
    return x
}

type Pair[T any] struct {
    Left  T
    Right T
}
```

---

## 6.3 Trait Bound（where T: Trait）

Rust 用 trait 描述“能力”，用 bound 限定泛型类型必须具备该能力。

- 函数层面的 bound
```rust
use std::fmt::Display;

fn show_twice<T: Display>(x: T) {
    println!("{x} {x}");
}
```

- where 子句：更清晰可读的写法（推荐在复杂约束时使用）
```rust
use std::fmt::{Display, Debug};

fn debug_and_show<T, U>(t: T, u: U)
where
    T: Debug + Display,
    U: Display,
{
    println!("t(debug) = {:?}, t(display) = {}", t, t);
    println!("u = {}", u);
}
```

- 结构体与 impl 上的 bound
```rust
use std::ops::Add;

#[derive(Debug, Clone, Copy)]
struct Vec2<T> { x: T, y: T }

impl<T> Vec2<T> {
    fn new(x: T, y: T) -> Self { Self { x, y } }
}

impl<T> Add for Vec2<T>
where
    T: Add<Output = T> + Copy,
{
    type Output = Vec2<T>;
    fn add(self, rhs: Self) -> Self::Output {
        Vec2 { x: self.x + rhs.x, y: self.y + rhs.y }
    }
}
```

- Blanket impl（“为所有满足条件的类型实现某 trait”）
```rust
trait ToJson {
    fn to_json(&self) -> String;
}

impl<T> ToJson for T
where
    T: std::fmt::Debug,
{
    fn to_json(&self) -> String {
        format!("\"{:?}\"", self)
    }
}

fn main() {
    println!("{}", 123.to_json());
    println!("{}", vec![1,2,3].to_json());
}
```

Go 的对照（约束更偏 type set 或方法集）：
```go
type Stringer interface { String() string }

func ShowTwice[T fmt.Stringer](x T) {
    fmt.Println(x.String(), x.String())
}
```

---

## 6.4 高级：关联类型 vs 额外泛型参数

在 Go 中，常用“接口方法返回另一个类型”或“接口上额外泛型参数”表达多类型关系；Rust 借助“关联类型”更直观。

- 无关联类型的写法（需要向外暴露更多泛型参数）：
```rust
trait IteratorLike<T> {
    fn next(&mut self) -> Option<T>;
}
```

- 使用关联类型的写法（推荐）：
```rust
trait IteratorLike {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}

struct Counter { cur: usize, end: usize }

impl IteratorLike for Counter {
    type Item = usize;
    fn next(&mut self) -> Option<Self::Item> {
        if self.cur < self.end {
            let v = self.cur;
            self.cur += 1;
            Some(v)
        } else {
            None
        }
    }
}
```

- 结合标准库 Iterator
```rust
fn sum_iter<I>(mut it: I) -> I::Item
where
    I: Iterator,
    I::Item: std::ops::Add<Output = I::Item> + Default + Copy,
{
    let mut acc = I::Item::default();
    while let Some(v) = it.next() {
        acc = acc + v;
    }
    acc
}

fn main() {
    let v = vec![1,2,3,4];
    let total = sum_iter(v.into_iter());
    println!("{total}");
}
```

优点：关联类型让“这个实现的元素类型是什么”成为实现细节的一部分，接口调用方无需总是把 Item 当成额外的泛型参数显式传递。

---

## 6.5 多 trait 组合与自动派生

- 使用“+”组合多个约束
```rust
use std::fmt::{Debug, Display};

fn log_and_show<T>(x: T)
where
    T: Debug + Display + Clone,
{
    println!("dbg: {:?}, show: {}", x.clone(), x);
}
```

- 常见的可派生 trait
  - Debug、Clone、Copy、PartialEq、Eq、PartialOrd、Ord、Hash、Default
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct Point { x: i32, y: i32 }
```

- 在 impl 上附加 trait bound
```rust
impl<T> Point where T: Default {}
```

---

## 6.6 泛型与生命周期 bound

Rust 的泛型常与生命周期搭配出现，用于表达“返回值里含有对入参的借用”。

- 简单示例
```rust
fn first<'a, T>(slice: &'a [T]) -> Option<&'a T> {
    slice.get(0)
}
```

- 结合 trait bound
```rust
use std::fmt::Display;

fn display_ref<'a, T>(x: &'a T)
where
    T: Display + 'a, // T 中的引用不能活得比 'a 短
{
    println!("{x}");
}
```

- 返回带引用的泛型结构体
```rust
#[derive(Debug)]
struct View<'a, T> {
    head: Option<&'a T>,
    len: usize,
}

impl<'a, T> View<'a, T> {
    fn from_slice(s: &'a [T]) -> Self {
        Self { head: s.first(), len: s.len() }
    }
}
```

Go 中基本不涉及生命周期标注，Rust 则通过生命周期使“借用关系”在编译期被验证，从而避免悬垂引用与数据竞争。

---

## 6.7 const generics（常量泛型）

用于在类型层表达“编译期常量”，比如矩阵维度、固定容量缓冲区。

```rust
#[derive(Debug, Clone, Copy)]
struct Matrix<const R: usize, const C: usize> {
    data: [[f64; C]; R],
}

impl<const R: usize, const C: usize> Matrix<R, C> {
    fn zeros() -> Self { Self { data: [[0.0; C]; R] } }
}

fn main() {
    let m: Matrix<2, 3> = Matrix::zeros();
    println!("{:?}", m);
}
```

Go 里一般会用切片长度或运行期检查；Rust 的 const generics 将维度作为类型一部分，带来更强的不变量保障与潜在优化。

---

## 6.8 零成本抽象（Zero-cost Abstraction）

“抽象不应带来额外的运行时开销”，Rust 通过单态化与内联优化，通常可将泛型抽象“烧平”为与手写专用代码等价的机器码。

- 对比示例：泛型 vs 专用实现
```rust
#[inline(always)]
fn sum_generic<T>(xs: &[T]) -> T
where
    T: Copy + std::ops::Add<Output = T> + Default,
{
    let mut acc = T::default();
    for &x in xs {
        acc = acc + x;
    }
    acc
}

fn sum_i32(xs: &[i32]) -> i32 {
    let mut acc = 0;
    for &x in xs {
        acc += x;
    }
    acc
}

fn main() {
    let v = vec![1,2,3,4,5];
    // 在优化编译下，两者通常生成等价的机器码
    println!("{}", sum_generic(&v));
    println!("{}", sum_i32(&v));
}
```

- 动态分发与零成本的权衡
  - 使用 trait object（Box<dyn Trait>）引入动态分发与间接调用，不再单态化；灵活但有微小开销。
  - 泛型（静态分发）则单态化，无虚调用开销，但代码尺寸可能增大（多类型实例化）。
  - 工程建议：性能敏感路径偏静态分发；需要可扩展插件式系统时用动态分发。

---

## 6.9 Rust trait object 与 Go interface 的差别

- 相似点：都能在运行时通过“某种 vtable”实现多态。
- 区别点：
  - Go interface 隐式实现，方法集决定兼容性；Rust 需要 impl Trait for Type，受孤儿规则约束。
  - Rust 的 trait object 需要对象安全（object safety），即 trait 内不能有泛型方法等导致对象不安全的特性。
  - 语法：
    - Go: var s fmt.Stringer = myType
    - Rust: let s: &dyn std::fmt::Display = &my_value;

- 示例：trait object 的使用
```rust
use std::fmt::Display;

fn print_all(xs: &[&dyn Display]) {
    for x in xs {
        println!("{x}");
    }
}

fn main() {
    let a = 42;
    let b = "hello";
    print_all(&[&a, &b]);
}
```

---

## 6.10 边界技巧：默认方法、特化、newtype 模式

- 默认方法：在 trait 中提供缺省实现，减少样板代码
```rust
trait Area {
    fn area(&self) -> f64;
    fn describe(&self) -> String {
        format!("area={}", self.area())
    }
}

struct Circle { r: f64 }
impl Area for Circle {
    fn area(&self) -> f64 { std::f64::consts::PI * self.r * self.r }
}
```

- 特化（specialization）：当前仍是不稳定特性，生产建议用“更具体 impl 覆盖更泛 impl”的模式受限；实际工程可用“新类型（newtype）”或“细分 trait”来达成接近效果。

- newtype 模式：用包裹类型引入新的 trait 实现，不污染原类型的全局 impl
```rust
struct CommaSep<T>(Vec<T>);

impl<T: std::fmt::Display> std::fmt::Display for CommaSep<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (i, v) in self.0.iter().enumerate() {
            if i > 0 { write!(f, ",")?; }
            write!(f, "{v}")?;
        }
        Ok(())
    }
}

fn main() {
    let s = CommaSep(vec![1,2,3]).to_string();
    assert_eq!(s, "1,2,3");
}
```

---

## 6.11 与错误处理、异步的结合

- 与 Result 配合：为错误类型加 trait，有助于在泛型函数中统一处理。
```rust
use std::fmt::Display;

fn log_err<T, E>(res: Result<T, E>) -> Result<T, E>
where
    E: Display,
{
    if let Err(e) = &res {
        eprintln!("error: {e}");
    }
    res
}
```

- 异步函数中的泛型与 Send/Sync bound
```rust
use std::future::Future;

async fn fetch_and_process<F, Fut, T>(f: F) -> T
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = T> + Send,
    T: Send + 'static,
{
    let v = f().await;
    v
}
```

在服务端开发中，常见把 handler 泛型出来，并用 Send + Sync + 'static 保障在线程池/任务调度器中的可安全移动。

---

## 6.12 从 Go 迁移 Rust 的实践建议

- 小步前进：先以“trait 表达行为接口”，再逐步引入关联类型与 where 子句优化可读性。
- 优先静态分发：性能敏感的路径尽量使用泛型与 trait bound，除非确需运行时扩展性。
- 合理派生：充分使用 #[derive(...)] 辅助常见 trait，减少样板。
- 用关联类型减少“泛型参数爆炸”，避免把所有类型关系都挂到函数签名上。
- 利用 const generics 在类型层固定关键不变量（容量、维度），提升安全与优化空间。
- 遇到编译期复杂 bound 报错时，优先用 where 子句拆分并引入类型别名，提升可读性。

---

## 6.13 练习

1) 为一个通用缓存实现 trait：
- 要求：支持 get/set，键必须可哈希与比较，值可克隆。
- 接口：
```rust
use std::collections::HashMap;
use std::hash::Hash;

trait Cache<K, V> {
    fn set(&mut self, k: K, v: V);
    fn get(&self, k: &K) -> Option<&V>;
}

struct HashCache<K, V> {
    inner: HashMap<K, V>,
}

impl<K, V> Cache<K, V> for HashCache<K, V>
where
    K: Eq + Hash,
{
    fn set(&mut self, k: K, v: V) { self.inner.insert(k, v); }
    fn get(&self, k: &K) -> Option<&V> { self.inner.get(k) }
}
```
- 思考：如何为 HashCache 增加 LRU 能力？是否使用 const generics 固定容量？

2) 将一个 Go 的接口改写为 Rust trait 并使用关联类型简化签名：
- Go:
```go
type Decoder[T any] interface {
    Decode([]byte) (T, error)
}
```
- Rust（示意）：
```rust
trait Decoder {
    type Out;
    type Err;
    fn decode(&self, bytes: &[u8]) -> Result<Self::Out, Self::Err>;
}
```

---

## 6.14 小结

- Rust 泛型通过 trait bound 精准表达“能力”，结合 where、关联类型与 const generics，拥有强大的抽象能力与编译期优化空间。
- 与 Go 相比，Rust 在编译期严格性、表达力、零成本抽象方面更领先；学习曲线更陡，但可在服务端高性能场景中获得显著回报。
- 实战原则：能在类型系统里表达的约束尽量提前到编译期，既提升可读性与可维护性，也给优化器“放手一搏”的空间。