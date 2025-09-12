# 第10章：数据库与 ORM：从 Go 到 Rust 的平滑迁移

面向对象：有多年 Go 后端经验、熟悉 database/sql、sqlx、GORM、迁移工具（goose/migrate）、连接池、事务与测试的工程师。本章帮助你快速掌握 Rust 在数据库访问上的主流选择、差异化理念与最佳实践。

章节结构：
- 为什么 Rust 数据访问与 Go 不同
- 生态概览：sqlx、SeaORM、Diesel（以及 Prisma、rbatis 等简单提及）
- 连接与连接池、配置与迁移
- 查询模式：原生 SQL、Query Builder、ActiveRecord/Entity
- 扫描/映射与类型安全
- 事务与并发/异步
- 性能、可观测性与错误处理
- 测试与本地开发
- 项目结构建议（面向服务/仓储分层）
- 实战示例：从 Go 写法到 Rust 写法的逐段对照

---

## 1. Rust 与 Go 在数据访问上的核心差异

- 类型安全更强：Rust 常把 SQL 与模型的类型关系前置校验（编译期或启动期），避免运行期错。
- 异步为先（tokio 生态）：大多数连接驱动与 ORM 提供 async API，配合连接池高并发。
- 所有权与生命周期：避免悬空引用，查询数据常以 owned 类型返回（结构体拥有数据），减少 borrow 复杂度。
- 错误显式传播：`Result<T, E>` 强制处理错误，使事务与资源释放更加健壮。
- 宏与代码生成：Diesel 借助宏生成强类型查询；SeaORM 通过生成 Entity/Model；sqlx 可用 `query!` 做编译期检查。

与 Go 的映射关系：
- database/sql + sqlx ≈ Rust sqlx（风格接近，原生 SQL + 辅助宏，简单直接）
- GORM ≈ SeaORM（更像 ORM，有实体、ActiveModel、关系、迁移集成）
- 强类型查询构建器 ≈ Diesel（最强类型安全，学习曲线较陡）

---

## 2. 生态概览

- sqlx：无宏实体层的“轻 ORM”。主打原生 SQL + 编译期校验（`query!` 宏需要配置数据库 URL），支持 Postgres、MySQL、SQLite、MSSQL。易迁移自 Go 的 sqlx。
- SeaORM：面向实体的异步 ORM，代码生成 Entity/Model/ActiveModel，支持关系、迁移、查询构建，体验类似 GORM。对业务大型化、关系复杂场景友好。
- Diesel：同步为主（也有 async 支持，但生态以同步著称），以宏和 schema 强类型保证查询安全。性能与类型安全顶级，曲线较陡。
- 其他：rbatis（模仿 MyBatis）、Prisma（多语言，Rust 客户端相对新），生产推荐优先三大主流。

选型建议：
- Go 背景、喜欢写 SQL、追求直观：sqlx
- 想要完整 ORM 能力（关系、代码生成、迁移、较少手写 SQL）：SeaORM
- 极致类型安全、可接受宏/生成与强约束：Diesel

---

## 3. 连接、连接池与配置

Rust 常用 `dotenvy` 或环境变量，`sqlx` 与 `SeaORM` 默认基于 `tokio`：

Cargo.toml（示例分别给出 sqlx 与 sea-orm 依赖，不一定同项目同时使用）
```toml
[package]
name = "rust-db-demo"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1.39", features = ["macros", "rt-multi-thread"] }
dotenvy = "0.15"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }

# 选型一：sqlx（以 Postgres 为例）
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "macros", "chrono", "uuid"] }

# 选型二：SeaORM
sea-orm = { version = "1.0", features = ["sqlx-postgres", "runtime-tokio-rustls", "macros"] }
sea-orm-migration = "1.0"
```

.env
```
DATABASE_URL=postgres://user:password@localhost:5432/appdb
RUST_LOG=info
```

初始化 tracing、加载配置并建立连接（sqlx）：
```rust
use anyhow::Result;
use dotenvy::dotenv;
use std::env;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use tracing::{info, error};
use tracing_subscriber::EnvFilter;

pub async fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();
}

pub async fn init_pool() -> Result<Pool<Postgres>> {
    dotenv().ok();
    let url = env::var("DATABASE_URL")?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(5)
        .connect_timeout(std::time::Duration::from_secs(5))
        .after_connect(|conn, _meta| Box::pin(async move {
            // 可做 per-connection 初始化，如设置 search_path
            sqlx::query("SET TIME ZONE 'UTC'").execute(conn).await?;
            Ok(())
        }))
        .connect(&url)
        .await?;
    info!("DB pool ready");
    Ok(pool)
}
```

SeaORM 建立连接：
```rust
use sea_orm::{Database, DatabaseConnection};
use anyhow::Result;

pub async fn init_seaorm_conn() -> Result<DatabaseConnection> {
    let url = std::env::var("DATABASE_URL")?;
    let db = Database::connect(url).await?;
    Ok(db)
}
```

对 Go 开发者的对照：
- 类似 `sql.Open` + `db.SetMaxOpenConns` 等；Rust 将池参数放在构建器上（`PgPoolOptions`）。
- 连接是异步建立；错误用 `Result` 返回。

---

## 4. 迁移：与 goose/migrate 的类比

- sqlx：提供 `sqlx migrate`（目录 `migrations/`），以纯 SQL 文件管理；也可用 refinery。
- SeaORM：提供 `sea-orm-cli`（或 `sea-orm-migration` crate）可用 Rust 代码或 SQL 管理迁移，且与 Entity 同源。

sqlx 迁移示例：
```
migrations/
  20240910120000_create_users.sql
  20240910121000_add_index_users_email.sql
```
`20240910120000_create_users.sql`：
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
运行：
```bash
sqlx migrate add -r create_users
sqlx migrate run
```

SeaORM 迁移（Rust 代码定义）：
```rust
// migration/src/m20240910_120000_create_users.rs
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Users::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Users::Id).uuid().not_null().primary_key())
                    .col(ColumnDef::new(Users::Email).string().not_null().unique_key())
                    .col(ColumnDef::new(Users::Name).string().not_null())
                    .col(ColumnDef::new(Users::CreatedAt).timestamp_with_time_zone().not_null().default(Expr::current_timestamp()))
                    .to_owned()
            )
            .await
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(Users::Table).to_owned()).await
    }
}

#[derive(Iden)]
enum Users {
    Table,
    Id,
    Email,
    Name,
    CreatedAt,
}
```

---

## 5. 查询模式对照：原生 SQL、Builder、Entity

在 Go：
- database/sql + sqlx：写 SQL，`Scan(&x)` 或 `StructScan(&obj)`
- GORM：方法链/Struct 条件，生成 SQL
在 Rust：
- sqlx：写 SQL，`query!`/`query_as!`，或者运行时 `query_as::<_, T>`
- SeaORM：Entity/Column 构建查询；支持关联、预加载
- Diesel：宏生成强类型查询

### 5.1 sqlx —— 原生 SQL 与类型校验

定义数据模型（owned 类型，避免生命周期麻烦）：
```rust
use chrono::{DateTime, Utc};
use uuid::Uuid;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}
```

查询单行（编译期校验，需启用 `DATABASE_URL` 或 offline feature）：
```rust
use sqlx::prelude::*;
use sqlx::{Pool, Postgres};

pub async fn find_user_by_email(pool: &Pool<Postgres>, email: &str) -> Result<Option<User>, sqlx::Error> {
    let rec = sqlx::query_as!(
        User,
        r#"
        SELECT id, email, name, created_at
        FROM users
        WHERE email = $1
        "#,
        email
    )
    .fetch_optional(pool)
    .await?;
    Ok(rec)
}
```

插入返回：
```rust
pub async fn create_user(pool: &Pool<Postgres>, email: &str, name: &str) -> Result<User, sqlx::Error> {
    let rec = sqlx::query_as!(
        User,
        r#"
        INSERT INTO users (email, name)
        VALUES ($1, $2)
        RETURNING id, email, name, created_at
        "#,
        email, name
    )
    .fetch_one(pool)
    .await?;
    Ok(rec)
}
```

动态查询（运行时映射）：
```rust
pub async fn list_users(pool: &Pool<Postgres>, name_like: Option<&str>) -> Result<Vec<User>, sqlx::Error> {
    if let Some(pat) = name_like {
        sqlx::query_as::<_, User>(
            "SELECT id, email, name, created_at FROM users WHERE name ILIKE $1 ORDER BY created_at DESC"
        )
        .bind(pat)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, User>(
            "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC"
        )
        .fetch_all(pool)
        .await
    }
}
```

批量插入：
```rust
pub async fn bulk_insert(pool: &Pool<Postgres>, rows: &[(String, String)]) -> Result<u64, sqlx::Error> {
    // rows: Vec<(email, name)>
    let mut tx = pool.begin().await?;
    for (email, name) in rows {
        sqlx::query("INSERT INTO users (email, name) VALUES ($1, $2)")
            .bind(email)
            .bind(name)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(rows.len() as u64)
}
```

注意：若追求更高效的批量，可使用 `COPY`（Postgres）或批量语句构造。

### 5.2 SeaORM —— 类 GORM 的开发体验

生成实体（sea-orm-cli 或 sea-orm-codegen）后通常会得到：
```
entity/
  users.rs
  mod.rs
```

典型 Entity 内容（简化）：
```rust
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
```

查询：
```rust
use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Condition, sea_query::Expr};

pub async fn sea_find_user_by_email(db: &DatabaseConnection, email: &str) -> Result<Option<entity::users::Model>, sea_orm::DbErr> {
    entity::users::Entity::find()
        .filter(entity::users::Column::Email.eq(email))
        .one(db)
        .await
}

pub async fn sea_list_users(db: &DatabaseConnection, name_like: Option<&str>) -> Result<Vec<entity::users::Model>, sea_orm::DbErr> {
    let mut stmt = entity::users::Entity::find();
    if let Some(pat) = name_like {
        stmt = stmt.filter(entity::users::Column::Name.like(pat));
    }
    stmt.order_by_desc(entity::users::Column::CreatedAt)
        .all(db)
        .await
}

pub async fn sea_create_user(db: &DatabaseConnection, email: &str, name: &str) -> Result<entity::users::Model, sea_orm::DbErr> {
    use sea_orm::ActiveModelTrait;
    let am = entity::users::ActiveModel {
        email: Set(email.to_string()),
        name: Set(name.to_string()),
        ..Default::default()
    };
    am.insert(db).await
}
```

事务：
```rust
use sea_orm::{TransactionTrait, Set};

pub async fn sea_tx_example(db: &DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    let txn = db.begin().await?;
    entity::users::ActiveModel {
        email: Set("a@ex.com".to_string()),
        name: Set("A".to_string()),
        ..Default::default()
    }.insert(&txn).await?;

    entity::users::ActiveModel {
        email: Set("b@ex.com".to_string()),
        name: Set("B".to_string()),
        ..Default::default()
    }.insert(&txn).await?;

    txn.commit().await?;
    Ok(())
}
```

### 5.3 Diesel —— 强类型查询构建

schema 定义（通过 diesel cli 生成）：
```rust
table! {
    users (id) {
        id -> Uuid,
        email -> Text,
        name -> Text,
        created_at -> Timestamptz,
    }
}
```

模型与查询（简化）：
```rust
use diesel::prelude::*;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Queryable)]
struct User {
    id: Uuid,
    email: String,
    name: String,
    created_at: DateTime<Utc>,
}

fn find_user_by_email(conn: &mut PgConnection, email: &str) -> QueryResult<Option<User>> {
    use crate::schema::users::dsl::*;
    users.filter(email.eq(email))
         .first::<User>(conn)
         .optional()
}
```

Diesel 特点：编译期保证字段一致性、强静态类型、防止拼写错误；但初学门槛较高。

---

## 6. 扫描/映射与类型安全

Go 的 `Scan` 或 `StructScan` 是运行时；Rust:
- sqlx `query!`/`query_as!` 在编译期对列名/类型进行校验（需要数据库可达或 offline.json 预生成元数据）。
- SeaORM 通过代码生成的 Entity/Column 保证一致性。
- Diesel 以宏生成 schema，所有字段受类型系统约束。

对 Go 开发者的提示：
- 尽量使用 owned 模型（String、Uuid、DateTime 等），避免 &str/&[u8] 的借用生命周期复杂度。
- 让模型派生 `serde::{Serialize, Deserialize}` 方便 HTTP 层编解码。

---

## 7. 事务、并发与异步

- sqlx：`pool.begin().await?` 获取 `Transaction`，可多次 `execute`，完成 `commit()`，失败自动回滚。
- SeaORM：`db.begin().await?` 返回事务连接，Entity API 可接收事务句柄。
- Diesel：同步事务 `conn.transaction(|tx| { ... })`。

并发注意事项：
- 事务句柄不可跨线程 Send/Sync 的细节由驱动决定；通常在一个 async 任务内使用同一事务。
- 大并发下控制 max_connections，避免数据库过载。对于只读高频查询，可引入只读副本与连接池隔离。

sqlx 事务示例（含错误传播）：
```rust
use sqlx::{Pool, Postgres};
use anyhow::{Context, Result};

pub async fn transfer(pool: &Pool<Postgres>, from: uuid::Uuid, to: uuid::Uuid, amount: i64) -> Result<()> {
    let mut tx = pool.begin().await.context("begin tx")?;

    let debited = sqlx::query!("UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1", amount, from)
        .execute(&mut *tx).await?.rows_affected();

    if debited == 0 {
        // 不足额
        return Err(anyhow::anyhow!("insufficient funds"));
    }

    sqlx::query!("UPDATE accounts SET balance = balance + $1 WHERE id = $2", amount, to)
        .execute(&mut *tx).await?;

    tx.commit().await.context("commit tx")?;
    Ok(())
}
```

---

## 8. 性能、可观测性与错误处理

- tracing：统一日志与 span，配合 SQL 层的 `sqlx::query!` 可在错误时包含 SQL 上下文。
- 连接池参数：遵循数据库实例能力设置上限；压测指导调优。
- 预编译/批量：利用数据库特性（Postgres 的 COPY、批量 INSERT，或使用服务端 prepared statements）。
- 错误处理：使用 `thiserror` 或 `anyhow` 建立领域错误与基础设施错误的清晰边界；对外进行合适的 HTTP 状态码映射。

示例：领域错误
```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum UserError {
    #[error("user not found")]
    NotFound,
    #[error("email already exists")]
    EmailExists,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
```

---

## 9. 测试与本地开发

推荐使用 testcontainers 或 docker-compose 拉起数据库；也可使用临时 schema 前缀或事务回滚。

tokio + sqlx 基础测试：
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    async fn test_pool() -> Pool<Postgres> {
        // 读取测试数据库 URL，或使用 testcontainers 启动临时实例
        let url = std::env::var("TEST_DATABASE_URL").unwrap();
        PgPoolOptions::new().max_connections(5).connect(&url).await.unwrap()
    }

    #[tokio::test]
    async fn test_create_and_query_user() {
        let pool = test_pool().await;

        // 每个测试用独立事务，结束后回滚，保证隔离
        let mut tx = pool.begin().await.unwrap();
        let user = sqlx::query_as!(
            User,
            r#"INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id,email,name,created_at"#,
            "t@ex.com", "Test"
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();

        let got = sqlx::query_as!(User, r#"SELECT id,email,name,created_at FROM users WHERE id=$1"#, user.id)
            .fetch_optional(&mut *tx)
            .await
            .unwrap();

        assert!(got.is_some());
        tx.rollback().await.unwrap();
    }
}
```

SeaORM 测试思路类似，事务用 `db.begin().await?`。

---

## 10. 项目结构建议（面向服务/仓储分层）

Go 常见：
- internal/repository, internal/service, pkg/model
Rust 可参考：
```
src/
  domain/
    user.rs                 # 领域模型（不直接依赖具体 ORM）
  infra/
    db.rs                   # 连接池/连接初始化
    repository/
      mod.rs
      user_repo.rs          # 仓储实现（sqlx/SeaORM）
  service/
    user_service.rs         # 业务服务，组合仓储
  web/
    handlers.rs             # HTTP 层（axum/actix-web）
```

域模型与仓储 trait：
```rust
// src/domain/user.rs
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[async_trait::async_trait]
pub trait UserRepo: Send + Sync {
    async fn find_by_email(&self, email: &str) -> anyhow::Result<Option<User>>;
    async fn create(&self, email: &str, name: &str) -> anyhow::Result<User>;
}
```

sqlx 仓储实现：
```rust
// src/infra/repository/user_repo_sqlx.rs
use super::super::super::domain::{User, UserRepo};
use async_trait::async_trait;
use sqlx::{Pool, Postgres};

pub struct UserRepoSqlx {
    pool: Pool<Postgres>,
}

impl UserRepoSqlx {
    pub fn new(pool: Pool<Postgres>) -> Self { Self { pool } }
}

#[async_trait]
impl UserRepo for UserRepoSqlx {
    async fn find_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        let rec = sqlx::query_as!(
            User,
            "SELECT id, email, name, created_at FROM users WHERE email=$1",
            email
        ).fetch_optional(&self.pool).await?;
        Ok(rec)
    }

    async fn create(&self, email: &str, name: &str) -> anyhow::Result<User> {
        let rec = sqlx::query_as!(
            User,
            "INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id,email,name,created_at",
            email, name
        ).fetch_one(&self.pool).await?;
        Ok(rec)
    }
}
```

服务层可不关心具体 ORM，实现替换成本小。

---

## 11. 从 Go 写法到 Rust 写法对照

Go + sqlx（伪示例）：
```go
type User struct {
    ID        uuid.UUID  `db:"id"`
    Email     string     `db:"email"`
    Name      string     `db:"name"`
    CreatedAt time.Time  `db:"created_at"`
}

func FindUserByEmail(ctx context.Context, db *sqlx.DB, email string) (*User, error) {
    var u User
    err := db.GetContext(ctx, &u, `SELECT id,email,name,created_at FROM users WHERE email=$1`, email)
    if errors.Is(err, sql.ErrNoRows) { return nil, nil }
    return &u, err
}
```

Rust + sqlx：
```rust
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct User { /* 同上 */ }

pub async fn find_user_by_email(pool: &sqlx::Pool<sqlx::Postgres>, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as!(
        User,
        "SELECT id, email, name, created_at FROM users WHERE email=$1",
        email
    ).fetch_optional(pool).await
}
```

Go GORM：
```go
type User struct {
  ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
  Email string `gorm:"unique"`
  Name string
  CreatedAt time.Time
}

func CreateUser(db *gorm.DB, email, name string) (*User, error) {
  u := &User{Email: email, Name: name}
  if err := db.Create(u).Error; err != nil { return nil, err }
  return u, nil
}
```

Rust SeaORM：
```rust
pub async fn create_user(db: &sea_orm::DatabaseConnection, email: &str, name: &str) -> Result<entity::users::Model, sea_orm::DbErr> {
    use sea_orm::{ActiveModelTrait, Set};
    let am = entity::users::ActiveModel {
        email: Set(email.to_string()),
        name: Set(name.to_string()),
        ..Default::default()
    };
    am.insert(db).await
}
```

---

## 12. 常见坑与最佳实践

- 避免借用返回：查询结果结构体尽量使用 owned 字段（String、Uuid 等），减少生命周期困扰。
- 启用 `sqlx::query!` 的编译期校验：保证列名/类型正确；离线模式可通过 `cargo sqlx prepare` 生成 metadata。
- 连接池参数与数据库容量匹配，避免雪崩；只读/写分离使用不同池。
- 显式处理错误并在服务层转换为领域错误；避免把底层错误细节直接暴露到接口层。
- 迁移与实体/模型的变更要同步，保持 CI 中有校验步骤。
- 使用 tracing 与慢查询日志，定位性能瓶颈；必要时写原生 SQL，配合索引优化。

---

## 13. 小结

- 如果你在 Go 中常用 sqlx，Rust 的 sqlx 几乎“无缝迁移”，并且多了编译期校验。
- 如果你在 Go 中习惯 GORM，Rust 的 SeaORM 能提供接近体验且异步友好。
- Diesel 的强类型对大型复杂查询的可靠性极佳，但上手成本较高。
- Rust 的所有权与异步模型让高并发数据库访问更可控、更安全；通过良好分层与错误边界，项目可维护性也会提升。
