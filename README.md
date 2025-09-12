# 《Go程序员的Rust从入门到精通》

> 📖 在线阅读：https://studyzy.github.io/Gopher-Learning-Rust/ | 📄 下载PDF：https://studyzy.github.io/Gopher-Learning-Rust/assets/gopher-learning-rust.pdf

本书面向有多年 Go 经验、正在迁移或引入 Rust 的工程师，强调“思维迁移 + 工程落地 + 性能与可靠性”。大纲与章节安排与 SUMMARY 保持一致，便于对照学习与检索。

---

## 第一部分：语言思维转换
1. 核心差异对比
   - 内存管理：Go 的 GC vs Rust 的所有权/借用
   - 并发模型：goroutine+channel vs async/await+Future+runtime
   - 错误处理：error 接口 vs Result<T, E> + ?
   - 包管理：Go Modules vs Cargo
   - 类型系统：Go 接口的鸭子类型 vs Rust 的泛型 + trait bounds
2. Rust 基础语法 vs Go
   - 变量/可变性：let/mut vs var
   - 控制流：if/match vs if/switch
   - 集合：Vec/HashMap vs slice/map
   - 闭包与函数：Fn/FnMut/FnOnce 对比 Go 匿名函数

## 第二部分：所有权与生命周期
3. 所有权核心规则
   - Move/Copy 语义与借用（& / &mut）
   - 生命周期何时需要显式标注
4. 集合与字符串
   - Vec/slice 边界与借用
   - String/str 与 UTF-8 注意事项
5. 常见陷阱
   - 悬垂引用、可变与不可变引用冲突
   - 结构体/函数签名中的生命周期设计

## 第三部分：类型系统与抽象
6. 结构体、枚举与特征
   - Enum + 模式匹配对比 Go 的常量 + switch
   - Trait vs 接口；trait 对象（dyn Trait）与动态分发
7. 泛型与约束
   - 泛型与 where 子句
   - 零成本抽象与单态化的取舍

## 第四部分：Rust 后端必备技能
8. 异步编程
   - Future 状态机本质、.await、执行器
   - Tokio 任务/定时器/IO
   - Go channel 对照 tokio::sync::mpsc/oneshot
9. 网络编程
   - hyper 与 axum（对标 Go net/http 与 gin）
   - JSON：serde vs encoding/json
   - gRPC：tonic vs Go gRPC
10. 数据库与 ORM
   - SQLx、SeaORM、Diesel
   - 连接池、迁移、事务实践

## 第五部分：并发与多线程
11. 并发模型
   - std::thread vs goroutine
   - tokio::spawn vs Go routine
   - Mutex/RwLock vs sync.Mutex/RWMutex
   - Channel 对照（std 与 tokio）
12. Actor 模型
   - actix 与消息驱动
   - 与 Go 中基于 channel 的 CSP 对比

## 第六部分：工程化与实践
13. 项目管理
   - Cargo 工作区、feature flag、CI/CD
   - 测试/基准：cargo test/bench vs go test/bench
14. 日志与配置
   - tracing、结构化日志、OpenTelemetry
   - 配置合并与环境覆盖（config/serde）
15. 微服务与分布式
   - gRPC/HTTP 微服务
   - 中间件（认证、指标、日志）
   - 容器化与部署对比（Kubernetes/Docker）

## 第七部分：实战项目
16. 从零搭建后端
   - axum + tokio + sqlx + redis 构建 RESTful
   - JWT 鉴权、gRPC 接入、Prometheus + OTel 监控
   - Docker/K8s 部署
17. 高级主题
   - Unsafe Rust（与 Go unsafe 对照）
   - FFI（与 C/Go 互操作）
   - WASM、边缘计算、性能调优与 Profiling

## 第八部分：从 Go 到 Rust 的思维升级
18. 生产环境中的 Rust
   - 何时选择 Rust，如何与 Go 共存
   - SLO/延迟尾部、内存曲线、可观测性
   - 迁移策略与渐进式替换

## 附：Go 程序员学习 Rust 常见问题
- 常见问题总览与对照实践指南：src/faq.md

---

👉 学完本书，你将能够：
- 理解 Rust 与 Go 的核心差异并完成思维迁移；
- 使用 Rust 构建可上线的后端服务与微服务组件；
- 在 Go 系统中用 Rust 重写性能热点或以 FFI/IPC 集成；
- 建立工程化能力：测试、观测、构建与跨平台发布；
- 针对生产环境做出正确的语言/架构技术决策。