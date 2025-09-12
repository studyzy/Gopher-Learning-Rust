# 学习路径指南

本指南为有Go经验的开发者提供了学习Rust的结构化路径。

## 🎯 学习目标

通过本教程，你将能够：
- 理解Rust与Go的核心差异
- 掌握Rust的所有权系统和内存安全机制  
- 使用Rust构建高性能的Web服务
- 开发可维护的微服务架构

## 📚 推荐学习顺序

### 第一阶段：基础概念 (1-2周)
1. [基础语法对比](./chapters/01-basic-syntax/README.md) - 理解语法差异
2. [内存管理](./chapters/02-memory-management/README.md) - 所有权系统
3. [错误处理](./chapters/03-error-handling/README.md) - Result vs Error

### 第二阶段：并发与类型系统 (1-2周)  
4. [并发模型](./chapters/04-concurrency/README.md) - Async vs Goroutines
5. [类型系统](./chapters/05-type-system/README.md) - 泛型和trait
6. [包管理](./chapters/06-package-management/README.md) - Cargo vs Go modules

### 第三阶段：实战开发 (2-3周)
7. [测试](./chapters/07-testing/README.md) - 单元测试和集成测试
8. [HTTP服务器](./chapters/09-http-server/README.md) - Web开发基础
9. [数据库集成](./chapters/10-database/README.md) - 数据持久化

### 第四阶段：工业级应用 (2-3周)
10. [中间件](./chapters/11-middleware/README.md) - 认证、日志等
11. [配置与日志](./chapters/12-config-logging/README.md) - 生产环境配置
12. [微服务架构](./chapters/13-microservices/README.md) - 分布式系统
13. [性能优化](./chapters/15-performance/README.md) - 性能调优

## 💡 学习建议

### 对于Go开发者
- **先理解概念差异**：重点学习所有权系统，这是最大的思维转换
- **动手实践**：每章都有练习，建议完成所有代码示例
- **对比学习**：每章都有Go vs Rust的对比，有助于理解
- **渐进式学习**：不要跳过基础章节，循序渐进

### 常见学习难点
1. **所有权系统** - 最重要也最难理解的概念
2. **生命周期** - 编译器的严格检查
3. **异步编程** - 与Go的goroutines不同的模型
4. **错误处理** - Result类型的函数式处理

### 实践项目建议
- 从简单的CLI工具开始
- 逐步构建HTTP API
- 最后尝试完整的微服务项目

## 🔗 额外资源

- [Rust官方书籍](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)
- [示例项目](./examples/) - 完整的Todo API实现

## ❓ 获取帮助

- 在GitHub Issues中提问
- 参考每章的练习答案
- 查看完整示例项目