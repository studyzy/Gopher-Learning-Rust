# Cargo 测试/基准命令与 CI 速用

本页聚焦命令层面，对照 Go 的 `go test`/`go test -bench`，便于在 CI/本地快速落地。概念与示例详见《Rust 单元测试与基准测试（给 Go 程序员）》。

## 1. 本地常用命令

- 运行全部测试（含单元与集成）：
  ```
  cargo test
  ```
- 过滤测试名（相当于 `go test -run`）：
  ```
  cargo test keyword
  ```
- 打印被捕获输出：
  ```
  cargo test -- --nocapture
  ```
- 单线程执行（复现竞态）：
  ```
  cargo test -- --test-threads=1
  ```
- 忽略/慢测：
  - 标记：`#[ignore]`
  - 运行：`cargo test -- --ignored`

## 2. 异步测试

- Tokio：
  ```
  #[tokio::test]
  async fn my_async_test() { ... }
  ```

## 3. Mock 与资源隔离

- trait + `mockall` 生成 mock
- HTTP：`mockito`/`httpmock`
- 文件系统：`assert_fs`，临时目录自动清理

## 4. 覆盖率（CI 常用）

- 安装：
  ```
  cargo install cargo-llvm-cov
  ```
- 生成 HTML 报告并合并工作区：
  ```
  cargo llvm-cov --workspace --all-features --html
  ```

## 5. 基准测试（criterion）

- 目录：`benches/*.rs`
- 运行：
  ```
  cargo bench
  ```
- 报告路径：`target/criterion/report/index.html`
- 防止优化折叠：
  ```rust
  use std::hint::black_box;
  ```

## 6. GitHub Actions 最小工作流

.github/workflows/ci.yml（示例）
```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Cache Cargo
        uses: Swatinem/rust-cache@v2
      - name: Lint
        run: cargo clippy --all-targets --all-features -- -D warnings
      - name: Format
        run: cargo fmt -- --check
      - name: Test
        run: cargo test --all-features --all-targets
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install llvm-cov
        run: cargo install cargo-llvm-cov
      - name: Coverage
        run: cargo llvm-cov --workspace --all-features --lcov --output-path lcov.info
```

对照 Go：
- `go test ./...` ≈ `cargo test --workspace`
- `go test -bench=. -benchmem` ≈ `cargo bench`（criterion 默认提供更全面统计）