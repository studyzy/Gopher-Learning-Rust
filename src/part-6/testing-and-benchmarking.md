# Rust 单元测试与基准测试

> 面向从 Go 迁移到 Rust 的工程师，重点对照 `go test`/`go test -bench` 的用法与心智模型差异，并提供常用 mocking/异步/快照测试等实战范式。

## 1. 心智对照：Go vs Rust 测试生态

- 入口与命令
  - Go：`go test ./...`，自动发现以 `_test.go` 结尾文件，函数以 `TestXxx` 命名。
  - Rust：`cargo test`，自动发现 `#[test]` 标记的函数。测试通常与被测模块同 crate 内（同文件或 `tests/` 目录）。
- 断言
  - Go：`t.Errorf` / `require/assert`（第三方）。
  - Rust：内置 `assert!`、`assert_eq!`、`assert_ne!`，复杂断言常配合 `pretty_assertions` 等库。
- 隔离/可见性
  - Go：包级测试，`_test.go` 可能在同包或 `_test` 后缀包隔离可见性。
  - Rust：模块私有性严格，测试通常放在 `#[cfg(test)] mod tests` 内；黑盒测试放在 `tests/` 顶层目录，以外部使用者视角引入 crate。
- Mock
  - Go：基于接口（动态派发）易手写 mock 或用 `gomock`.
  - Rust：偏静态分发。常用 `mockall`/`double` 生成 trait 的 mock；HTTP 场景用 `mockito`/`httpmock`。
- Benchmark
  - Go：`go test -bench=. -benchmem`
  - Rust：原生稳定通道移除了旧 `cargo bench`（nightly `test` 特性），工业界主推 `criterion` 库，统计稳健且报告友好。

## 2. 快速开始：最小 Rust 单测

src/lib.rs
```rust
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_basic() {
        assert_eq!(add(1, 2), 3);
    }

    #[test]
    #[should_panic(expected = "overflow")]
    fn test_add_overflow_should_panic() {
        // 故意触发：仅示意 should_panic 的写法
        let _ = i32::MAX.checked_add(1).expect("overflow");
    }
}
```

- `#[cfg(test)]`：仅在 `cargo test` 编译测试模块。
- `#[test]`：标记测试函数。
- `#[should_panic]`：等价于 Go 里用 `defer` + recover 断言 panic，但更声明式。

运行：
```
cargo test
```

## 3. 表驱动测试（Go 风格）在 Rust 的写法

Go 常用切片驱动表格；Rust 用数组/Vec + for 循环或 `rstest` 宏。

示例（无第三方）：
```rust
#[test]
fn test_add_table_driven() {
    let cases = [
        (1, 2, 3),
        (0, 0, 0),
        (-1, 1, 0),
    ];
    for (a, b, want) in cases {
        let got = super::add(a, b);
        assert_eq!(got, want, "a={}, b={}", a, b);
    }
}
```

使用 `rstest` 更加优雅（需依赖）：
Cargo.toml
```toml
[dev-dependencies]
rstest = "0.22"
```
src/lib.rs
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    #[case(1, 2, 3)]
    #[case(0, 0, 0)]
    #[case(-1, 1, 0)]
    fn test_add_cases(#[case] a: i32, #[case] b: i32, #[case] want: i32) {
        assert_eq!(add(a, b), want);
    }
}
```

## 4. 测试布局与可见性

- 单元测试（白盒，访问私有项）
  - 通常内嵌在被测模块文件中：`#[cfg(test)] mod tests { use super::*; }`
- 集成测试（黑盒，从外部像用户一样使用 crate）
  - 放在 `tests/` 目录，每个 `.rs` 是一个独立 crate：
```
my-crate/
  src/lib.rs
  tests/api_test.rs
```
tests/api_test.rs
```rust
use my_crate::add;

#[test]
fn works_from_public_api() {
    assert_eq!(add(2, 3), 5);
}
```
- 工作区（workspace）建议：
  - 每个 crate 自测；公共契约放在集成测试；跨 crate 的端到端可在根 `tests/` 组织。

对照 Go：
- Rust 的黑盒测试强制通过公开 API，逼迫你打磨合理的对外接口边界。

## 5. 常用断言与输出

- 断言
  - `assert!(cond)`、`assert_eq!(left, right)`、`assert_ne!(left, right)`
  - 建议引入 `pretty_assertions` 提升失败 diff 可读性（dev-dependencies）：
    ```toml
    [dev-dependencies]
    pretty_assertions = "1"
    ```
    ```rust
    use pretty_assertions::assert_eq;
    ```
- 捕获输出：`cargo test -- --nocapture` 显示 `println!`；默认测试通过时不显示输出。

## 6. 异步单测（对照 Go 的并发/异步）

在 Go 中，测试函数可直接 `t.Parallel()` 并发；Rust 异步需要执行器（Tokio/async-std）。

Tokio 示例：
Cargo.toml
```toml
[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```
src/lib.rs
```rust
pub async fn fetch_data() -> Result<String, ()> {
    Ok("ok".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fetch_data() {
        let s = fetch_data().await.unwrap();
        assert_eq!(s, "ok");
    }
}
```

要点：
- 使用 `#[tokio::test]` 提供 async 运行时。
- 对照 Go：Rust 的 async 是显式、零隐藏线程；并发控制更精细。

## 7. Mocking 实战

与 Go 的接口+动态派发不同，Rust 通过 trait 进行抽象，然后用 mocking 库生成实现。

- mockall（最常用）
  - 适用：为 trait 生成可配置期望的 mock。
  - 依赖：
    ```toml
    [dev-dependencies]
    mockall = "0.13"
    ```
  - 示例：
    ```rust
    pub trait Kv {
        fn get(&self, key: &str) -> Option<String>;
        fn set(&self, key: &str, val: String);
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use mockall::{mock, predicate::*};

        mock! {
            pub MemoryKv {}
            impl Kv for MemoryKv {
                fn get(&self, key: &str) -> Option<String>;
                fn set(&self, key: &str, val: String);
            }
        }

        #[test]
        fn test_kv_with_mock() {
            let mut kv = MockMemoryKv::new();
            kv.expect_get()
              .with(eq("k1"))
              .return_const(Some("v1".to_string()));
            assert_eq!(kv.get("k1"), Some("v1".into()));
        }
    }
    ```
- double
  - 轻量替代，语法偏简洁：`double = "0.3"`
- HTTP Mock
  - `mockito = "1"`：本地起服务拦截 HTTP；或 `httpmock = "0.7"`
  - 示例（mockito）：
    ```rust
    #[cfg(test)]
    mod tests {
        use mockito::Server;

        #[test]
        fn test_http_with_mockito() {
            let mut server = Server::new();
            let _m = server.mock("GET", "/ping")
                .with_status(200)
                .with_body("pong")
                .create();

            let url = format!("{}/ping", server.url());
            let body = reqwest::blocking::get(url).unwrap().text().unwrap();
            assert_eq!(body, "pong");
        }
    }
    ```
  - 对照 Go 的 `httptest.Server`，心智相似。

Tips：
- 通过 trait 抽象 I/O，生产环境注入真实实现，测试注入 mock。
- 避免在类型上到处使用 `impl Trait` 而无法替换，必要时引入显式 trait 对象 `dyn Trait` 以便注入。

## 8. 临时目录、快照与 Golden Files

- 临时目录
  - `tempfile = "3"` 或 `assert_fs = "1"`
  - 示例（assert_fs）：
    ```toml
    [dev-dependencies]
    assert_fs = "1"
    ```
    ```rust
    use assert_fs::prelude::*;

    #[test]
    fn test_with_tmp_dir() {
        let tmp = assert_fs::TempDir::new().unwrap();
        let file = tmp.child("data.txt");
        file.write_str("hello") .unwrap();
        file.assert("hello");
        // 退出自动清理
    }
    ```
- 快照测试（对照 Go 的 golden file）
  - `insta = "1"`：维护快照文件，首次 `cargo insta review` 进行基线确认：
    ```toml
    [dev-dependencies]
    insta = { version = "1", features = ["yaml"] }
    ```
    ```rust
    use insta::assert_yaml_snapshot;

    #[test]
    fn test_snapshot() {
        let data = vec![1,2,3];
        assert_yaml_snapshot!(data);
    }
    ```
  - 对照 Go：使用 `testdata` + golden 文件；insta 提供更完善的审阅工作流。

## 9. 选择性运行、并发与过滤

- 仅运行匹配名称的测试：
  ```
  cargo test add -- --nocapture
  ```
- 运行单文件/模块内测试：使用测试名过滤或 Rust Analyzer 测试运行器。
- 并发度：`cargo test -- --test-threads=1` 控制并发，默认为 CPU 核心数。
- 忽略慢测：`#[ignore]` 后用 `cargo test -- --ignored` 运行。

## 10. 基准测试（Benchmark）

对照：
- Go：`go test -bench=. -benchmem`
- Rust 推荐：`criterion`（稳定、统计稳健、报告完善）

依赖：
```toml
[dev-dependencies]
criterion = "0.5"
```
典型布局（lib crate）：
- 新增 `benches/` 目录，文件如 `benches/add_bench.rs`
benches/add_bench.rs
```rust
use criterion::{criterion_group, criterion_main, Criterion};

fn add(a: i64, b: i64) -> i64 { a + b }

fn bench_add(c: &mut Criterion) {
    c.bench_function("add", |b| {
        b.iter(|| {
            let mut s = 0;
            for i in 0..1000 {
                s = add(s, i);
            }
            s
        })
    });
}

criterion_group!(benches, bench_add);
criterion_main!(benches);
```

运行：
```
cargo bench
```

输出：
- 统计信息（均值、方差）、回归检测、HTML 报告（`target/criterion/report/index.html`）。
- 可配置测量时间/采样策略，类似 Go 的 `-benchtime`，但更自动化。

Nightly 原生 bench（`#![feature(test)]`）：
- 不建议用于生产项目；CI 与团队协作更推荐 `criterion`。

与 Go 的对照建议：
- 将“微基准”保持最小化副作用；避免内联/编译器优化“把被测代码折叠掉”（可用 `black_box`）。
  ```rust
  use std::hint::black_box;
  let x = black_box(heavy_compute(black_box(input)));
  ```

## 11. 覆盖率与报告

- 覆盖率
  - Go：`go test -cover -coverprofile=…`
  - Rust：使用 `cargo tarpaulin`（Linux 最佳）或基于 `llvm-cov` 的工具链（跨平台更好）：
    - `cargo-llvm-cov` 推荐：
      ```
      cargo install cargo-llvm-cov
      cargo llvm-cov --html
      ```
- 报告整合：上传到 CI（例如 Codecov），与 Go 流程类似。

## 12. CI 与测试剖面

- GitHub Actions 常见步骤：
  - `cargo test --all-features --all-targets`
  - `cargo clippy -- -D warnings`
  - `cargo fmt -- --check`
  - 基准测试不建议在 PR 阶段跑，可按日/周基线或手动触发。
- 工作区建议：
  - `cargo test -p your-crate-a -p your-crate-b` 精准化执行。
  - 对公共 crate 跑黑盒集成测试，避免对内部实现过度耦合。

## 13. 常见坑与最佳实践

- 模块私有性与测试：
  - 白盒测试放模块内：`use super::*;`；黑盒测试放 `tests/`。
- trait 设计以便 mock：
  - 面向抽象编程，注入 `Box<dyn Trait>` 或泛型参数化。
- 异步测试中的资源清理：
  - 使用 `Drop` 自动回收；或显式关闭后台任务（类似 Go 的 context 取消）。
- 随机性与非确定性：
  - 固定随机种子或隔离并发；使用 `tokio::time::pause` + `advance` 控制时间流逝。
- 可重复与隔离：
  - 用 `assert_fs`/`tempfile` 保证无副作用；HTTP 用 mock server；DB 用事务回滚或 `testcontainers`.

## 14. 速查清单（Cheat Sheet）

- 运行所有测试：`cargo test`
- 过滤名称：`cargo test keyword`
- 显示 println：`cargo test -- --nocapture`
- 单线程：`cargo test -- --test-threads=1`
- 忽略测试：`#[ignore]` + `cargo test -- --ignored`
- 异步测试：`#[tokio::test]`
- 表驱动：`rstest` 或手写数组循环
- Mock：
  - trait + `mockall`/`double`
  - HTTP：`mockito`/`httpmock`
- 临时目录/快照：`assert_fs`、`insta`
- 覆盖率：`cargo llvm-cov --html`
- 基准：`criterion` + `cargo bench`

---

参考与延伸：
- Rust Book: Testing
- mockall 文档：https://docs.rs/mockall
- criterion 文档：https://bheisler.github.io/criterion.rs/book/
- insta 快照测试：https://insta.rs
- cargo-llvm-cov：https://github.com/taiki-e/cargo-llvm-cov