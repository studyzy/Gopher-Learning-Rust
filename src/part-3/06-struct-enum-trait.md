# 第6章：Struct / Enum / Trait

面向 Go 后端开发者的 Rust 结构化编程三件套：Struct、Enum 和 Trait。本章以 Go 的既有心智模型为基础，系统讲清 Rust 的语法、语义与工程实践差异，帮助你用“Go 的方式”迅速掌握“Rust 的写法”。

目录：
- Struct 对比 Go struct
- Enum + 模式匹配
- Trait 与 Trait 对象（dyn Trait）对比 Go 接口
- 实战：用 Struct + Enum + Trait 设计一个后端请求处理框架
- 高级话题与坑位清单

---

## 5.1 Struct 对比 Go struct

Rust 的 `struct` 和 Go 的 `struct` 在“表达数据结构”上相似，但在“所有权/借用/生命周期、可见性、方法绑定、默认值和构造方式”等方面有本质差异。

### 5.1.1 定义与可见性

- Go：字段默认包内可见（小写私有，大写导出）
- Rust：默认私有（对模块），使用 `pub` 导出；可按字段粒度控制可见性

示例（Rust）：
```rust
// src/lib.rs
pub struct User {
    pub id: u64,        // 对外可见
    username: String,   // 默认私有
}

impl User {
    pub fn new(id: u64, username: impl Into<String>) -> Self {
        Self { id, username: username.into() }
    }
    pub fn username(&self) -> &str {
        &self.username
    }
}
```

对照（Go）：
```go
type User struct {
    ID       uint64 // 导出
    username string // 包内私有
}

func NewUser(id uint64, username string) *User {
    return &User{ID: id, username: username}
}
func (u *User) Username() string {
    return u.username
}
```

要点：
- Rust 没有“构造函数”关键字，常用 `new` 关联函数。
- Rust 不鼓励直接暴露可变字段，更偏向暴露只读引用和受控的 setter（考虑不变量与安全性）。

### 5.1.2 所有权与方法接收者

Go 方法接收者可为值或指针；Rust 方法接收者三种常见形态：
- `&self`：不可变借用
- `&mut self`：可变借用
- `self`：移动所有权（常用于 builder 消费或不可复制的数据）

```rust
#[derive(Debug)]
struct Counter(u64);

impl Counter {
    fn peek(&self) -> u64 {
        self.0
    }
    fn bump(&mut self) {
        self.0 += 1;
    }
    fn into_inner(self) -> u64 {
        // self 被移动并消费
        self.0
    }
}
```

对照（Go）：
```go
type Counter uint64

func (c Counter) Peek() uint64 { // 值接收者
    return uint64(c)
}

func (c *Counter) Bump() { // 指针接收者
    *c = *c + 1
}
```

要点：
- Rust 的 `&mut self` 保证独占可变借用，编译期避免数据竞争。
- 选择 `self` 作为接收者可以表达“构造—消费”链式 API。

### 5.1.3 字面量、默认值与构建模式

- Rust 支持结构体更新语法与 `Default` trait。
- 推荐为配置型结构实现 `Default + builder`。

```rust
#[derive(Debug)]
struct ServerCfg {
    host: String,
    port: u16,
    tls: bool,
}

impl Default for ServerCfg {
    fn default() -> Self {
        Self { host: "127.0.0.1".into(), port: 8080, tls: false }
    }
}

impl ServerCfg {
    fn with_host(mut self, host: impl Into<String>) -> Self { self.host = host.into(); self }
    fn with_port(mut self, port: u16) -> Self { self.port = port; self }
    fn enable_tls(mut self) -> Self { self.tls = true; self }
}

fn main() {
    let cfg = ServerCfg::default()
        .with_host("0.0.0.0")
        .with_port(9000)
        .enable_tls();
    println!("{cfg:?}");
}
```

结构体更新：
```rust
#[derive(Clone)]
struct Opts { retries: u32, timeout_ms: u64 }
let base = Opts { retries: 3, timeout_ms: 1000 };
let fast = Opts { timeout_ms: 200, ..base.clone() };
```

对照（Go）：
- 没有语法级 Default，常用工厂函数或零值语义。
- Builder 模式需手写或使用函数式选项模式。

### 5.1.4 拷贝、克隆与派生

- Rust：`Copy` 是位拷贝语义（小型标量），`Clone` 是显式深/浅复制 API。
- Go：赋值为浅拷贝，引用类型共享底层。

```rust
#[derive(Copy, Clone)]
struct Point { x: i32, y: i32 } // 小型标量可 Copy

#[derive(Clone)]
struct Big { data: Vec<u8> } // Vec 不可 Copy，但可 Clone
```

思维差异：
- 在 Rust 中，移动是默认行为，克隆需显式 `.clone()`，促使你关注成本与所有权。

---

## 5.2 Enum + 模式匹配

Go 只有“常量枚举（iota）”，没有代数数据类型（ADT）。Rust 的 `enum` 是代数数据类型，能表达“多形状”的数据及其载荷，是表达状态机、协议、错误的强力工具。

### 5.2.1 基础定义与载荷

```rust
enum Auth {
    Anonymous,
    Basic { username: String, password: String },
    Token(String),
}

fn auth_header(a: &Auth) -> String {
    match a {
        Auth::Anonymous => "Anonymous".into(),
        Auth::Basic { username, password } => {
            format!("Basic {}:{}", username, password)
        }
        Auth::Token(t) => format!("Bearer {t}"),
    }
}
```

Go 中的近似写法通常是多结构体 + 接口或用 `Kind` 字段手写判别，但 Rust `enum` 自带类型安全与匹配穷尽检查。

### 5.2.2 `Option` 与 `Result`

Rust 核心库的两个“枚举即哲学”：
- `Option<T>`：Some / None，代替 Go 中 `nil`（减少空指针）
- `Result<T, E>`：Ok / Err，代替 Go 的多返回值错误处理

```rust
fn find_user(id: u64) -> Option<String> {
    if id == 42 { Some("Alice".into()) } else { None }
}

fn parse_port(s: &str) -> Result<u16, std::num::ParseIntError> {
    s.parse::<u16>()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(name) = find_user(42) {
        println!("found: {name}");
    }

    let port = parse_port("8080")?; // ? 传播错误，等价于早返回
    println!("port: {port}");
    Ok(())
}
```

对照（Go）：
```go
func FindUser(id uint64) *string { // 或 (string, bool)
    if id == 42 { s := "Alice"; return &s }
    return nil
}

func ParsePort(s string) (uint16, error) { ... }
```

Rust 的 `?` 操作符让错误传播更加自然且类型安全。

### 5.2.3 模式匹配与穷尽性检查

`match` 要求覆盖所有分支，避免遗漏；`if let` 适合单分支解构：

```rust
enum Event {
    Connected(String),
    Disconnected,
    Message { from: String, body: String },
}

fn handle(ev: Event) {
    match ev {
        Event::Connected(addr) => println!("+ {addr}"),
        Event::Disconnected => println!("-"),
        Event::Message { from, body } if body.len() < 256 => {
            println!("msg({from}): {body}");
        }
        Event::Message { .. } => println!("msg too large"),
    }
}
```

特性：
- 模式可带守卫（`if`）
- 支持按名字解构、忽略（`_`、`..`）、绑定片段

### 5.2.4 状态机建模

Rust `enum` 适合表达“只能处于其一”的状态，编译器帮你保证转换完整。

```rust
#[derive(Debug)]
enum Conn {
    Disconnected,
    Connecting { retry: u32 },
    Online { peer: String },
}

impl Conn {
    fn connect(self) -> Self {
        match self {
            Conn::Disconnected => Conn::Connecting { retry: 0 },
            s => s, // 其他状态保持
        }
    }

    fn on_established(self, peer: String) -> Self {
        match self {
            Conn::Connecting { .. } => Conn::Online { peer },
            s => s,
        }
    }
}
```

---

## 5.3 Trait 与 Trait 对象（dyn Trait）对比 Go 接口

Rust 的 `trait` 类似 Go 的接口，但差异很大：
- Rust trait 支持“泛型静态派发”和“动态派发”
- Rust trait 支持默认方法、关联类型、泛型参数与约束
- 实现是“外部实现孤儿规则”约束下进行的
- 没有隐式实现（与 Go 一样是“结构性实现”，但需要 `impl` 明确定义）

### 5.3.1 定义与实现

```rust
trait Repository {
    fn get(&self, id: u64) -> Option<String>;
    fn put(&mut self, id: u64, val: String);

    // 默认方法
    fn exists(&self, id: u64) -> bool {
        self.get(id).is_some()
    }
}

struct MemoryRepo(std::collections::HashMap<u64, String>);

impl Repository for MemoryRepo {
    fn get(&self, id: u64) -> Option<String> {
        self.0.get(&id).cloned()
    }
    fn put(&mut self, id: u64, val: String) {
        self.0.insert(id, val);
    }
}
```

对照（Go）：
```go
type Repository interface {
    Get(id uint64) *string
    Put(id uint64, val string)
    Exists(id uint64) bool // Go 接口不能有默认实现，一般在实现体重复写
}
```

Rust trait 可有默认方法，减少重复。

### 5.3.2 静态派发（泛型）与动态派发（trait object）

- 静态派发：`fn handle<T: Repository>(repo: &mut T) { ... }`
  - 编译期单态化，零成本抽象，二进制可能膨胀
- 动态派发：`fn handle(repo: &mut dyn Repository) { ... }`
  - 运行时 vtable，类似 Go 接口值，需在堆或引用后使用

```rust
fn handle_static<R: Repository>(repo: &mut R) {
    repo.put(1, "Alice".into());
}

fn handle_dyn(repo: &mut dyn Repository) {
    repo.put(2, "Bob".into());
}

fn main() {
    let mut repo = MemoryRepo(Default::default());
    handle_static(&mut repo);
    handle_dyn(&mut repo);
}
```

在需要插件化、运行时可替换组件时，用 `Box<dyn Trait>`、`Arc<dyn Trait + Send + Sync>`。

```rust
use std::sync::Arc;

fn start_service(repo: Arc<dyn Repository + Send + Sync>) {
    // 在异步/多线程环境下共享
}
```

### 5.3.3 关联类型 vs 泛型参数

Rust trait 可以用“关联类型”表达输出类型关系，减少泛型污染。

```rust
trait Stream {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}

struct Ints(u32);

impl Stream for Ints {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        let v = self.0;
        if v > 0 { self.0 -= 1; Some(v) } else { None }
    }
}
```

与使用泛型参数的写法对比：
```rust
trait Stream2<T> {
    fn next(&mut self) -> Option<T>;
}
```

当输出类型依赖于实现者时，关联类型更自然；当调用点需要指定类型时，泛型参数更合适。

### 5.3.4 对象安全与 `dyn Trait`

不是所有 trait 都能做成 `dyn Trait`。对象安全要求（简化版）：
- 方法不返回 `Self`（或需置于 `where Self: Sized` 限制中）
- 方法参数中不能含有泛型类型参数
- 关联常量/某些关联类型用法会限制对象安全

解决方式：
- 将不对象安全的方法加 `where Self: Sized`
- 拆分成两个 trait：对象安全的接口 + 扩展 trait

```rust
trait Service {
    fn call(&self, req: &str) -> String;
    fn into_box(self) -> Box<dyn Service>
    where
        Self: Sized, // 使 trait 仍可创建对象，但该方法仅在具体类型上可用
    {
        Box::new(self)
    }
}
```

### 5.3.5 Blanket 实现与孤儿规则

- Blanket impl：为所有满足约束的类型提供实现（标准库广泛使用）
```rust
trait Jsonify { fn to_json(&self) -> String; }
impl<T: serde::Serialize> Jsonify for T {
    fn to_json(&self) -> String { serde_json::to_string(self).unwrap() }
}
```

- 孤儿规则：你只能为“你拥有的类型”或“你拥有的 trait”做 `impl`，防止冲突。
  - 若需要为外部类型实现外部 trait，用 newtype 包装。

```rust
struct MyUuid(uuid::Uuid);
impl std::fmt::Display for MyUuid {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
```

---

## 5.4 实战：用 Struct + Enum + Trait 设计一个后端请求处理框架

目标：以 Go 风格的 Handler/Router 心智，落地 Rust 版本，展示 enum 状态、trait 抽象、dyn 对象、安全可拓展的组合。

需求：
- 请求 Request，响应 Response
- Handler trait：同步版本（便于讲解），支持中间件
- 路由器 Router：按方法+路径匹配（简化）
- 错误处理：Result + 自定义错误枚举
- 可用 `Box<dyn Handler>` 动态组合

### 5.4.1 数据模型与错误

```rust
#[derive(Debug, Clone)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: Status,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
pub enum Method { GET, POST }

#[derive(Debug, Clone, Copy)]
pub enum Status { Ok, NotFound, BadRequest, Internal }

#[derive(Debug)]
pub enum AppError {
    NotFound,
    BadInput(String),
    Internal(String),
}

pub type Result<T> = std::result::Result<T, AppError>;
```

### 5.4.2 Trait 与 Handler 组合

```rust
pub trait Handler: Send + Sync {
    fn handle(&self, req: &Request) -> Result<Response>;
}

impl<F> Handler for F
where
    F: Fn(&Request) -> Result<Response> + Send + Sync,
{
    fn handle(&self, req: &Request) -> Result<Response> { (self)(req) }
}
```

说明：
- 提供闭包到 `Handler` 的 blanket 实现，使得快速注册处理逻辑。
- `Send + Sync` 使其可跨线程共享（为将来的异步或多线程打基础）。

### 5.4.3 Router 与匹配

```rust
use std::collections::HashMap;

pub struct Router {
    routes: HashMap<(Method, String), Box<dyn Handler>>,
    middlewares: Vec<Box<dyn Middleware>>,
}

impl Router {
    pub fn new() -> Self {
        Self { routes: HashMap::new(), middlewares: vec![] }
    }

    pub fn handle<H: Handler + 'static>(mut self, m: Method, path: impl Into<String>, h: H) -> Self {
        self.routes.insert((m, path.into()), Box::new(h));
        self
    }

    pub fn use_middleware<M: Middleware + 'static>(mut self, m: M) -> Self {
        self.middlewares.push(Box::new(m));
        self
    }

    pub fn serve(&self, req: &Request) -> Response {
        let mut ctx = Context::new(req.clone());
        let mut chain: Vec<&dyn Middleware> = self.middlewares.iter().map(|b| &**b).collect();

        // 末端处理器
        let endpoint = || -> Result<Response> {
            if let Some(h) = self.routes.get(&(req.method, req.path.clone())) {
                h.handle(&ctx.req)
            } else {
                Err(AppError::NotFound)
            }
        };

        // 逆序包裹中间件
        let mut next = Box::new(endpoint) as Box<dyn FnMut() -> Result<Response>>;
        while let Some(m) = chain.pop() {
            let mut inner = next;
            next = Box::new(move || m.handle(&mut ctx, &mut inner));
        }

        match next() {
            Ok(resp) => resp,
            Err(AppError::NotFound) => Response { status: Status::NotFound, body: b"not found".to_vec() },
            Err(AppError::BadInput(s)) => Response { status: Status::BadRequest, body: s.into_bytes() },
            Err(AppError::Internal(s)) => Response { status: Status::Internal, body: s.into_bytes() },
        }
    }
}
```

中间件定义：
```rust
pub struct Context {
    pub req: Request,
    pub locals: std::collections::HashMap<String, String>,
}
impl Context {
    fn new(req: Request) -> Self {
        Self { req, locals: HashMap::new() }
    }
}

pub trait Middleware: Send + Sync {
    fn handle(
        &self,
        ctx: &mut Context,
        next: &mut dyn FnMut() -> Result<Response>,
    ) -> Result<Response>;
}
```

示例中间件与路由：
```rust
struct Logger;
impl Middleware for Logger {
    fn handle(&self, ctx: &mut Context, next: &mut dyn FnMut() -> Result<Response>) -> Result<Response> {
        println!("--> {} {}", match ctx.req.method { Method::GET => "GET", Method::POST => "POST" }, ctx.req.path);
        let res = next()?;
        println!("<-- {:?}", res.status);
        Ok(res)
    }
}

fn main() {
    let router = Router::new()
        .use_middleware(Logger)
        .handle(Method::GET, "/hello", |_req| {
            Ok(Response { status: Status::Ok, body: b"hello".to_vec() })
        })
        .handle(Method::POST, "/echo", |req| {
            if req.body.len() > 1024 {
                return Err(AppError::BadInput("too large".into()));
            }
            Ok(Response { status: Status::Ok, body: req.body.clone() })
        });

    let ok = router.serve(&Request { method: Method::GET, path: "/hello".into(), body: vec![] });
    println!("{:?}", String::from_utf8_lossy(&ok.body));

    let echo = router.serve(&Request { method: Method::POST, path: "/echo".into(), body: b"ping".to_vec() });
    println!("{:?}", String::from_utf8_lossy(&echo.body));
}
```

说明：
- 动态派发：`Box<dyn Handler>` 和 `Box<dyn Middleware>` 让运行时注册表更灵活，类似 Go 中 `interface{}` 值。
- 错误设计：用 `enum` 表达不同错误，`match` 集中映射到 HTTP 状态。
- 中间件链：基于闭包组合，遵循对象安全约束。

可扩展方向：
- 异步版本：trait 使用 `async-trait` 或改为返回 `Future`（注意对象安全）
- 线程安全：将 `Router` 放入 `Arc`，并在多线程请求模拟中共享
- 路径参数：为 `Router` 增加模式匹配（如 `/users/:id`）

---

## 5.5 高级话题与坑位清单

- 可变别名/借用检查
  - Go 多 goroutine 共享 map 需加锁；Rust 在编译期阻止数据竞争。需要共享可变状态时，使用 `Mutex/Arc/RwLock`。
- 生命周期标注
  - 当结构体保存引用或 trait 泛型返回引用时会出现，需要理解“数据活得比引用久”原则；尽量用拥有所有权的类型（String、Vec）降低复杂度。
- 对象安全与异步
  - `async fn` 在 trait 中不是对象安全，需用 `async-trait` 或手写返回 `Pin<Box<dyn Future<Output=...> + Send>>`。
- 错误处理生态
  - `thiserror` 定义错误枚举，`anyhow` 用于应用层“快速抛错”与上下文增强，二者搭配常见。
- 序列化与配置
  - `serde` + `serde_json/toml/yaml`；为配置 `struct` 派生 `Deserialize` 并结合 `Default` 与 `#[serde(default)]`。
- 性能与可观测性
  - 静态派发通常更快；在热点路径避免不必要的 `Box<dyn Trait>`。
  - 使用 `tracing` 做结构化日志；`criterion` 做基准测试。

---

## 5.6 小结（Go 开发者迁移要点）

- Struct：更强调不可变性与受控可变；构造靠关联函数与 `Default`/builder；移动与克隆显式。
- Enum：是 Rust 的“多形状数据”基石，配合模式匹配实现更可靠的状态机与错误处理。
- Trait：统一抽象机制，静态派发零成本，动态派发可插拔；注意对象安全与孤儿规则。

建议练习：
1) 用 `enum` 重写你在 Go 项目里用 `Kind` 字段实现的“多类型消息”，再用 `match` 编排处理逻辑。
2) 将一组存储后端的抽象从 Go interface 迁移到 Rust trait，分别实现静态派发和动态派发版本的服务层。
3) 在本章 Router 示例基础上，加入路径参数、全局错误映射与异步支持（`tokio` + `async-trait`）。

参考库：
- anyhow / thiserror
- serde / serde_json
- tracing
- async-trait
- tokio