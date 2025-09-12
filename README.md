# 《Go程序员的Rust从入门到精通》

> 📖 **[在线阅读](https://studyzy.github.io/Gopher-Learning-Rust/)** | **[下载PDF版本](https://studyzy.github.io/Gopher-Learning-Rust/assets/gopher-learning-rust.pdf)**

## 第一部分：语言思维转换
### 1. Go 与 Rust 的核心差异
- **内存管理**：Go 的 GC vs Rust 的所有权 / 借用检查器
- **并发模型**：goroutine + channel vs async/await + Future + Tokio
- **错误处理**：Go 的 `error` 接口 vs Rust 的 `Result<T, E>` + `?` 运算符
- **包管理**：Go Modules vs Cargo + Crates.io
- **类型系统**：Go 接口的 duck typing vs Rust 泛型 + trait bounds

### 2. Rust 基础语法（对照 Go）
- 变量与常量：`let` / `mut` vs `var`
- 控制流：`if` / `match` vs `switch`
- 集合与切片：`Vec`, `HashMap` vs `slice`, `map`
- 函数与闭包：Fn, FnMut, FnOnce 对比 Go 的匿名函数

---

## 第二部分：所有权与生命周期
### 3. 所有权核心规则
- Move 语义 vs Go 的浅拷贝
- 借用（&T, &mut T）对照 Go 的指针
- 生命周期标注 `<'a>`：什么时候需要，什么时候编译器能推断

### 4. 常见坑与解决方案
- 悬垂引用问题
- 可变与不可变引用冲突
- 在结构体和函数签名中引入生命周期

---

## 第三部分：类型系统与抽象
### 5. Struct / Enum / Trait
- Struct 对比 Go 的 struct
- Enum 模式匹配 vs Go 无枚举，只能用常量 + switch
- Trait vs Go 接口
- Trait 对象（`dyn Trait`）vs Go 接口的动态派发

### 6. 泛型与约束
- Rust 泛型 vs Go 1.18+ 的泛型
- Trait Bound（`where T: Trait`）
- 零成本抽象的思想

---

## 第四部分：Rust 后端必备技能
### 7. 异步编程
- async/await 的本质（Future 状态机）
- Tokio 框架：任务调度、定时器、IO
- Go channel 对照 Rust `tokio::sync::mpsc` / `oneshot`

### 8. 网络开发
- `hyper` HTTP 框架 vs Go net/http
- `axum` 高层框架（类似 gin）
- JSON 序列化：`serde` vs Go `encoding/json`
- gRPC in Rust：`tonic` vs Go gRPC

### 9. 数据库与ORM
- SQLx（异步、编译期 SQL 校验）
- SeaORM / Diesel（ORM 框架）
- 对比 Go 的 GORM

---

## 第五部分：并发与多线程
### 10. 并发模型
- `std::thread` vs goroutine
- `tokio::spawn` vs Go routine
- Mutex / RwLock vs Go sync.Mutex
- Channel（`std::sync::mpsc` + `tokio::sync::mpsc`）对比 Go channel

### 11. Actor 模型
- `actix` 框架（Actor 并发）
- 与 Go 里基于 channel 的 CSP 模型对比

---

## 第六部分：工程化与实践
### 12. 项目管理
- Cargo 工作区 vs Go workspace
- Feature flag 管理 vs Go build tags
- 测试与 Benchmark：Rust 的 `cargo test` vs Go test/bench

### 13. 日志与配置
- `tracing` 日志系统 vs Go log + zap
- 配置管理：`config` crate vs Go viper

### 14. 微服务与分布式
- Rust 中实现 gRPC/HTTP 微服务
- 中间件（auth, metrics, logging）
- 与 Go 在 Kubernetes / Docker 中的应用对比

---

## 第七部分：实战项目
### 15. 从零构建 Rust 后端服务
- 使用 `axum + tokio + sqlx + redis` 写一个 RESTful 服务
- 实现 JWT 鉴权
- 接入 gRPC 接口
- Prometheus + OpenTelemetry 监控
- 部署到 Docker/K8s

### 16. 高级话题
- Unsafe Rust（和 Go unsafe 包的对比）
- FFI：Rust 调用 C / 被 C 调用
- WASM 与边缘计算
- 性能调优与 Profiling

---

## 第八部分：从 Go 到 Rust 的思维升级
- 什么时候用 Rust，什么时候仍然适合 Go
- 性能、内存控制、安全 vs 开发效率、快速迭代
- 如何在团队中推动 Rust 落地（与 Go 共存）

---

👉 学完这个大纲，你会有以下成果：
1. 熟悉 Rust 语言特性和所有权模型；  
2. 能用 Rust 开发可上线的后端服务；  
3. 能在 Go 项目中迁移或重构部分模块到 Rust；  
4. 具备对比两门语言的技术决策能力。  
