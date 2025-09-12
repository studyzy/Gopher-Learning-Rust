# Gopher Learning Rust 🦫➡️🦀

**Go程序员从入门到精通Rust教程**

通过学习本教程，你能在已有 Go 背景的基础上，快速建立 Rust 思维模式，并能写出工业级的后端服务。

## 📋 教程目录

### 第一部分：基础概念对比
- [第1章：Go vs Rust 基础语法对比](./chapters/01-basic-syntax/README.md)
- [第2章：内存管理：垃圾回收 vs 所有权](./chapters/02-memory-management/README.md)
- [第3章：错误处理：Error vs Result](./chapters/03-error-handling/README.md)
- [第4章：并发模型：Goroutines vs Async/Await](./chapters/04-concurrency/README.md)

### 第二部分：核心特性深入
- [第5章：类型系统与接口](./chapters/05-type-system/README.md)
- [第6章：包管理：Go Modules vs Cargo](./chapters/06-package-management/README.md)
- [第7章：测试与基准测试](./chapters/07-testing/README.md)
- [第8章：泛型编程](./chapters/08-generics/README.md)

### 第三部分：实战项目
- [第9章：构建HTTP服务器](./chapters/09-http-server/README.md)
- [第10章：数据库集成与ORM](./chapters/10-database/README.md)
- [第11章：中间件与认证](./chapters/11-middleware/README.md)
- [第12章：配置管理与日志](./chapters/12-config-logging/README.md)

### 第四部分：工业级后端服务
- [第13章：微服务架构](./chapters/13-microservices/README.md)
- [第14章：gRPC服务开发](./chapters/14-grpc/README.md)
- [第15章：性能优化与监控](./chapters/15-performance/README.md)
- [第16章：部署与DevOps](./chapters/16-deployment/README.md)

## 🎯 学习目标

完成本教程后，你将能够：

- ✅ 理解Rust与Go的核心差异和相似之处
- ✅ 掌握Rust的所有权系统和内存安全机制
- ✅ 使用Rust构建高性能的Web服务
- ✅ 开发可维护的微服务架构
- ✅ 应用Rust生态系统中的主流框架和工具
- ✅ 编写工业级的后端服务代码

## 🚀 快速开始

### 环境准备

1. 安装Rust工具链：
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

2. 验证安装：
```bash
rustc --version
cargo --version
```

3. 推荐的开发工具：
   - VSCode + rust-analyzer插件
   - IntelliJ IDEA + Rust插件
   - Vim/Neovim + rust.vim

### 学习建议

1. **循序渐进**：按章节顺序学习，每章都有Go对比示例
2. **动手实践**：每章都有练习题，建议完成所有代码示例
3. **项目导向**：第三部分开始构建完整的项目
4. **社区交流**：遇到问题可以在Issues中讨论

## 📚 参考资源

- [The Rust Programming Language](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)
- [The Go Programming Language](https://golang.org/doc/)
- [Awesome Rust](https://github.com/rust-unofficial/awesome-rust)

## 🤝 贡献

欢迎提交PR和Issues来改进本教程！

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
