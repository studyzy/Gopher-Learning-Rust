# 示例项目：Todo API (Rust版本)

这是一个展示如何用Rust构建工业级后端服务的完整示例项目。

## 🛠️ 技术栈

- **Web框架**: Warp
- **数据库**: PostgreSQL + SQLx
- **序列化**: Serde
- **配置管理**: Config
- **日志**: Tracing
- **验证**: Validator
- **错误处理**: Anyhow + Thiserror

## 🚀 快速开始

### 环境要求

- Rust 1.70+
- PostgreSQL 12+

### 安装和运行

1. 克隆项目
```bash
cd examples/todo-api-rust
```

2. 安装依赖
```bash
cargo build
```

3. 设置环境变量
```bash
export TODO_API_DATABASE_URL="postgresql://username:password@localhost/todoapp"
export TODO_API_SERVER_PORT="3000"
```

4. 运行数据库迁移
```bash
# 创建数据库和表
sqlx database create
sqlx migrate run
```

5. 启动服务
```bash
cargo run
```

## 📖 项目结构

```
src/
├── main.rs           # 应用入口点
├── config/           # 配置管理
│   └── mod.rs
├── models/           # 数据模型
│   └── mod.rs
├── handlers/         # HTTP处理器
│   └── mod.rs
└── services/         # 业务逻辑
    └── mod.rs
```

## 🔌 API端点

- `GET /todos` - 获取所有Todo
- `POST /todos` - 创建新Todo  
- `GET /todos/{id}` - 获取单个Todo
- `PUT /todos/{id}` - 更新Todo
- `DELETE /todos/{id}` - 删除Todo
- `GET /health` - 健康检查

## 📊 与Go版本的对比

| 特性 | Go版本 | Rust版本 |
|------|--------|----------|
| 类型安全 | 运行时 | 编译时 |
| 内存管理 | GC | 所有权 |
| 并发模型 | Goroutines | Async/await |
| 错误处理 | 多返回值 | Result类型 |
| 性能 | 很好 | 极佳 |

这个示例展示了如何将Go的后端开发经验迁移到Rust，同时利用Rust的独特优势构建更加安全和高性能的服务。