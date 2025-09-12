# 12. 项目管理

本章面向有 Go 后台经验的工程师，系统梳理 Rust 的项目管理与工程实践：如何用 Cargo 管理多包工作区、依赖与特性、环境配置、构建发布、质量保证与自动化、版本与发布流程等。目标是让你把“Go 工程化经验”迁移到 Rust，落地稳定的团队规范。

目录
- Cargo 基础与工作区（Workspace）
- 依赖与 Feature 管理（对照 Go Module 可选构建标签）
- 环境配置与多二进制/多环境
- 构建、交叉编译与发布（含 Docker）
- 质量保障：fmt、clippy、test、bench、doc
- 版本、变更日志与发布到 crates.io/私有源
- 配置管理与可观测性（env/log/metrics/tracing）
- 任务自动化：Makefile/just 与 CI 模板
- 项目骨架与目录结构建议
- 常见坑与最佳实践清单

——

## 1. Cargo 基础与工作区

Cargo 是 Rust 的包与构建工具，类似 Go 的 go mod + go build 的集合，但更关注“多包工作区”和“可选特性”。

单包初始化：
```bash
cargo new my-service            # 二进制 crate
cargo new my-lib --lib          # 库 crate
```

工作区（monorepo 多 crate）：
```
my-org/
├─ Cargo.toml        # 顶层 workspace 清单
├─ Cargo.lock
├─ services/
│  ├─ api/Cargo.toml
│  └─ worker/Cargo.toml
└─ libs/
   ├─ core/Cargo.toml
   └─ util/Cargo.toml
```

顶层 Cargo.toml（workspace）：
```toml
[workspace]
members = [
  "services/api",
  "services/worker",
  "libs/core",
  "libs/util",
]

# 可选：统一依赖版本（workspace.dependencies，Rust 1.64+）
[workspace.dependencies]
anyhow = "1"
serde = { version = "1", features = ["derive"] }
tracing = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "sync"] }
```

在子 crate 中引用同仓库库：
```toml
# services/api/Cargo.toml
[package]
name = "api"
version = "0.1.0"
edition = "2021"

[dependencies]
core = { path = "../../libs/core" }
util = { path = "../../libs/util" }
anyhow.workspace = true
serde.workspace = true
tokio.workspace = true
```

工作区构建/测试：
```bash
cargo build              # 构建全部成员
cargo test               # 运行全部测试
cargo run -p api         # 运行指定二进制
cargo check -p worker    # 快速类型检查
```

——

## 2. 依赖与 Feature 管理

Feature 是可选的编译单元，类似 Go 中“构建标签 + 可选依赖”的组合。通过 Feature：
- 精简生产二进制（例如只启用必要的组件）
- 提供可插拔实现（如不同存储后端）
- 分离开发/测试工具（如 tracing/metrics）

示例：在 core 库中定义特性
```toml
# libs/core/Cargo.toml
[features]
default = ["tracing"]           # 默认启用
postgres = ["sqlx/postgres", "runtime-tokio-rustls"]
mysql = ["sqlx/mysql", "runtime-tokio-rustls"]
mock = []                       # 测试场景

[dependencies]
sqlx = { version = "0.7", default-features = false, features = ["macros"] }
tracing = { version = "0.1", optional = true }
```

条件编译使用：
```rust
#[cfg(feature = "postgres")]
pub async fn init_db_pg(...) { /* ... */ }

#[cfg(feature = "mysql")]
pub async fn init_db_mysql(...) { /* ... */ }
```

启用特性：
```bash
cargo build -p api --features "postgres"
cargo build -p api --no-default-features --features "mysql"
```

注意：
- 避免“特性爆炸”，将互斥后端用互斥 feature gate。
- workspace 里可在顶层统一声明依赖版本，减少版本漂移。

——

## 3. 环境配置与多二进制/多环境

一个 crate 可以拥有多个二进制入口，适合“同仓库多服务/工具”。

多 bin：
```toml
# services/api/Cargo.toml
[[bin]]
name = "api"
path = "src/main.rs"

[[bin]]
name = "migrate"
path = "src/bin/migrate.rs"
```

配置管理（对照 Go 的 env + config 文件）：
- 建议使用 dotenvy + figment/config 或 serde + envy，从 env/TOML/JSON 等来源合并。
- 将配置定义为明确的结构体，提供默认值与校验。

示例：
```toml
# config/default.toml
[server]
addr = "0.0.0.0:8080"

[db]
url = "postgres://user:pass@localhost/db"
```

```rust
// services/api/src/config.rs
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct ServerCfg { pub addr: String }

#[derive(Debug, Deserialize, Clone)]
pub struct DbCfg { pub url: String }

#[derive(Debug, Deserialize, Clone)]
pub struct AppCfg {
    pub server: ServerCfg,
    pub db: DbCfg,
}

pub fn load() -> anyhow::Result<AppCfg> {
    let cfg: AppCfg = figment::Figment::new()
        .merge(figment::providers::Toml::file("config/default.toml"))
        .merge(figment::providers::Env::prefixed("APP_").split("__"))
        .extract()?;
    Ok(cfg)
}
```

多环境（dev/staging/prod）：
- 通过不同的配置文件或 Feature 切换（更推荐配置文件 + 环境变量）。
- 编译期与运行时分离：编译期只做实现选择，部署时用 env 注入具体配置。

——

## 4. 构建、交叉编译与发布（含 Docker）

常用命令：
```bash
cargo build --release
RUSTFLAGS="-C target-cpu=native" cargo build --release     # 针对本机优化
```

交叉编译：
- 首选 rustup target + musl/gnu toolchain；或使用 cross 工具自动化。
```bash
rustup target add x86_64-unknown-linux-gnu
rustup target add x86_64-unknown-linux-musl

# gnu
cargo build --release --target x86_64-unknown-linux-gnu

# musl（静态链接，适合极简容器）
cargo build --release --target x86_64-unknown-linux-musl
```

最小化 Docker 镜像：
```Dockerfile
# 1. 构建阶段
FROM rust:1.80 as builder
WORKDIR /app
COPY . .
# 可选：缓存依赖
RUN cargo build --release --bin api

# 2. 运行阶段（distroless 或 alpine + musl）
FROM gcr.io/distroless/cc
WORKDIR /app
COPY --from=builder /app/target/release/api /app/api
USER 65532:65532   # 非 root
EXPOSE 8080
ENTRYPOINT ["/app/api"]
```

注意：
- 若依赖 OpenSSL，优先选择 rustls 避免系统依赖复杂化（如 reqwest+rustls）。
- 对于 glibc 兼容性问题，musl 静态链接常更稳健。

——

## 5. 质量保障：fmt、clippy、test、bench、doc

格式化与静态检查：
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
```

测试与覆盖率：
```bash
cargo test --workspace --all-features
# 覆盖率（llvm-cov）
cargo install cargo-llvm-cov
cargo llvm-cov --workspace --html
```

基准测试（criterion）：
```toml
# Cargo.toml
[dev-dependencies]
criterion = "0.5"

[[bench]]
name = "my_bench"
harness = false
```

```rust
// benches/my_bench.rs
use criterion::{criterion_group, criterion_main, Criterion};
fn bench_parse(c: &mut Criterion) {
    c.bench_function("parse", |b| b.iter(|| { /* ... */ }));
}
criterion_group!(benches, bench_parse);
criterion_main!(benches);
```

文档：
```bash
cargo doc --workspace --no-deps --open
```

——

## 6. 版本、变更日志与发布

语义化版本（SemVer）：MAJOR.MINOR.PATCH，公共 API 的兼容性由 Cargo 生态严格遵循。

建议流程：
- 使用 conventional commits 或者 keep a changelog。
- 用 cargo-release 或 release-plz 自动化打 tag、更新版本与 CHANGELOG。

cargo-release 简例：
```toml
# Release.toml
sign-commit = false
sign-tag = false
consolidate-commits = true
push = true
```

私有 crates 源（企业内网）：
```toml
# .cargo/config.toml
[registries.my-internal]
index = "sparse+https://crates.mycorp.local/index"

# Cargo.toml
[dependencies]
mykit = { version = "0.3", registry = "my-internal" }
```

发布到 crates.io：
```bash
cargo login <TOKEN>
cargo publish
```

——

## 7. 配置管理与可观测性（env/log/metrics/tracing）

日志与链路（tracing）：
```toml
# Cargo.toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }
```

初始化：
```rust
use tracing_subscriber::{EnvFilter, fmt::layer, Registry};

pub fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,hyper=warn,sqlx=warn".into());
    let fmt = layer().with_target(false).json(); // 或者 .pretty()
    let _ = Registry::default().with(filter).with(fmt).try_init();
}
```

指标（metrics + exporter，如 prometheus）：
```toml
[dependencies]
metrics = "0.24"
metrics-exporter-prometheus = "0.15"
```

```rust
pub fn init_metrics() {
    use metrics_exporter_prometheus::PrometheusBuilder;
    PrometheusBuilder::new().install().expect("metrics init");
    metrics::increment_counter!("app_startups");
}
```

健康检查与探针：
- 提供 /healthz、/metrics、/readyz 等端点。
- 将依赖（DB/Cache）状态暴露为 gauge 或成功率直方图。

——

## 8. 任务自动化：Makefile/just 与 CI 模板

Makefile 示例：
```Makefile
.PHONY: fmt lint test build release doc

fmt:
\tcargo fmt --all

lint:
\tcargo clippy --all-targets --all-features -- -D warnings

test:
\tcargo llvm-cov --workspace --lcov --output-path lcov.info

build:
\tcargo build --release

doc:
\tcargo doc --workspace --no-deps

release:
\tcargo release patch
```

justfile（更简洁的命令脚本）：
```make
set shell := ["bash", "-cu"]

default: fmt lint test

fmt:    @cargo fmt --all
lint:   @cargo clippy --all-targets --all-features -- -D warnings
test:   @cargo test --workspace --all-features
bench:  @cargo bench
run api: @cargo run -p api
```

GitHub Actions（CI）：
```yaml
name: CI
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
      - name: Format
        run: cargo fmt --all -- --check
      - name: Clippy
        run: cargo clippy --all-targets --all-features -- -D warnings
      - name: Test
        run: cargo test --workspace --all-features
```

——

## 9. 项目骨架与目录结构建议

服务型项目建议：
```
services/api
├─ src/
│  ├─ main.rs              # 组装与引导
│  ├─ config.rs            # 配置加载
│  ├─ http/
│  │   ├─ mod.rs
│  │   ├─ router.rs
│  │   └─ handlers.rs
│  ├─ service/
│  │   ├─ mod.rs
│  │   └─ user.rs
│  ├─ repo/
│  │   ├─ mod.rs
│  │   └─ user_repo.rs
│  ├─ domain/
│  │   └─ model.rs
│  └─ telemetry.rs         # tracing/metrics
├─ config/
│  ├─ default.toml
│  └─ prod.toml
├─ benches/
├─ tests/                  # 集成测试
└─ Cargo.toml
```

常见实践：
- 将业务协议（DTO）单独成库 crate 供多服务复用（与 Go 的 shared pkg 类似）。
- 领域与基础设施明确分层：domain/repo/service/http。
- 集成测试放 tests/，可用 testcontainers-rs 启动真 DB/Cache。
- 所有可执行入口放在 [[bin]] 或 workspace 内的多个服务 crate。

——

## 10. 常见坑与最佳实践

- Feature 组合爆炸：将互斥实现互斥到同一特性组，不要累积不可控的组合。
- dev-dependencies 与 build-dependencies 区分清楚，避免引入到生产构建。
- 统一 Rust 版本与 edition：在 workspace 的 rust-toolchain.toml 固定版本，避免 CI/本地不一致。
```toml
# rust-toolchain.toml
[toolchain]
channel = "1.80"
components = ["rustfmt", "clippy"]
```
- 跨平台构建：优先 rustls，musl 静态链接减少运行时依赖。
- 性能剖析：用 pprof-rs 或 tokio-console（异步观测）辅助定位瓶颈。
- 安全与合规：cargo deny 审计依赖许可与漏洞。
```bash
cargo install cargo-deny
cargo deny check
```
- 可重现构建：锁定 Cargo.lock，CI 使用相同的 registry 源；尽量避免 git 依赖未锁定 commit。

——

## 小结

- Cargo/Workspace 让多 crate 管理自然高效，Feature 赋能可插拔实现与瘦身二进制。
- 用配置文件 + env 管理多环境；用 tracing/metrics 打造可观测性。
- 建立标准化自动化：fmt/clippy/test/bench/doc + CI + release。
- 构建/交叉编译与最小化容器镜像相结合，快速落地可部署制品。
- 以清晰的目录结构与分层约束复杂度，形成可规模化的团队工程规范。

练习
1) 建一个包含 api、worker、core、util 的工作区，统一依赖版本，api/worker 复用 core。
2) 为 core 增加 postgres/mysql 互斥特性，并在 CI 中矩阵测试两种构建。
3) 为 api 增加 /metrics 与 /healthz，跑通 GitHub Actions CI 全流程。
4) 增加 cross/musl 静态编译目标，产出可在最小化容器中运行的二进制。