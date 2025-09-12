# 第13章：微服务架构

本章将指导你如何使用Rust构建微服务架构，对比Go和Rust在微服务开发中的异同。

## 📖 目录
- [微服务架构概述](#微服务架构概述)
- [服务发现](#服务发现)
- [配置管理](#配置管理)
- [健康检查](#健康检查)
- [监控与追踪](#监控与追踪)
- [服务间通信](#服务间通信)
- [完整项目结构](#完整项目结构)
- [部署策略](#部署策略)

## 微服务架构概述

### 微服务的优势
- 独立部署和扩展
- 技术栈灵活性
- 故障隔离
- 团队自治

### Go vs Rust微服务对比

| 特性 | Go | Rust |
|------|----|----|
| 编译速度 | 快 | 较慢 |
| 运行时性能 | 很好 | 极佳 |
| 内存安全 | 运行时检查 | 编译时保证 |
| 并发模型 | Goroutines | Async/await |
| 生态系统 | 成熟 | 快速发展 |
| 学习曲线 | 平缓 | 陡峭 |

## 服务发现

### Go + Consul
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    
    "github.com/hashicorp/consul/api"
)

type ServiceRegistry struct {
    client *api.Client
}

func NewServiceRegistry() (*ServiceRegistry, error) {
    client, err := api.NewClient(api.DefaultConfig())
    if err != nil {
        return nil, err
    }
    
    return &ServiceRegistry{client: client}, nil
}

func (sr *ServiceRegistry) RegisterService(name, address string, port int) error {
    registration := &api.AgentServiceRegistration{
        ID:      fmt.Sprintf("%s-%s-%d", name, address, port),
        Name:    name,
        Address: address,
        Port:    port,
        Check: &api.AgentServiceCheck{
            HTTP:     fmt.Sprintf("http://%s:%d/health", address, port),
            Interval: "10s",
            Timeout:  "3s",
        },
    }
    
    return sr.client.Agent().ServiceRegister(registration)
}

func (sr *ServiceRegistry) DiscoverService(serviceName string) ([]*api.ServiceEntry, error) {
    services, _, err := sr.client.Health().Service(serviceName, "", true, nil)
    return services, err
}
```

### Rust + Consul
```rust
use consul::{Client, Config};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceRegistration {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub check: HealthCheck,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthCheck {
    pub http: String,
    pub interval: String,
    pub timeout: String,
}

pub struct ServiceRegistry {
    client: Client,
}

impl ServiceRegistry {
    pub fn new() -> Result<Self, consul::Error> {
        let config = Config::default();
        let client = Client::new(config)?;
        Ok(Self { client })
    }
    
    pub async fn register_service(
        &self,
        name: &str,
        address: &str,
        port: u16,
    ) -> Result<(), consul::Error> {
        let registration = ServiceRegistration {
            id: format!("{}-{}-{}", name, address, port),
            name: name.to_string(),
            address: address.to_string(),
            port,
            check: HealthCheck {
                http: format!("http://{}:{}/health", address, port),
                interval: "10s".to_string(),
                timeout: "3s".to_string(),
            },
        };
        
        self.client.agent.service_register(&registration).await
    }
    
    pub async fn discover_service(
        &self,
        service_name: &str,
    ) -> Result<Vec<consul::ServiceEntry>, consul::Error> {
        self.client
            .health
            .service(service_name, None, true, None)
            .await
    }
}
```

## 配置管理

### Go配置管理
```go
package config

import (
    "os"
    "strconv"
    "time"
)

type Config struct {
    Server   ServerConfig
    Database DatabaseConfig
    Redis    RedisConfig
    Logging  LoggingConfig
}

type ServerConfig struct {
    Port         int
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
}

type DatabaseConfig struct {
    Host     string
    Port     int
    User     string
    Password string
    Database string
}

type RedisConfig struct {
    Host     string
    Port     int
    Password string
    DB       int
}

type LoggingConfig struct {
    Level  string
    Format string
}

func Load() (*Config, error) {
    cfg := &Config{
        Server: ServerConfig{
            Port:         getEnvAsInt("SERVER_PORT", 8080),
            ReadTimeout:  getEnvAsDuration("SERVER_READ_TIMEOUT", 10*time.Second),
            WriteTimeout: getEnvAsDuration("SERVER_WRITE_TIMEOUT", 10*time.Second),
        },
        Database: DatabaseConfig{
            Host:     getEnv("DB_HOST", "localhost"),
            Port:     getEnvAsInt("DB_PORT", 5432),
            User:     getEnv("DB_USER", "postgres"),
            Password: getEnv("DB_PASSWORD", ""),
            Database: getEnv("DB_NAME", "myapp"),
        },
        Redis: RedisConfig{
            Host:     getEnv("REDIS_HOST", "localhost"),
            Port:     getEnvAsInt("REDIS_PORT", 6379),
            Password: getEnv("REDIS_PASSWORD", ""),
            DB:       getEnvAsInt("REDIS_DB", 0),
        },
        Logging: LoggingConfig{
            Level:  getEnv("LOG_LEVEL", "info"),
            Format: getEnv("LOG_FORMAT", "json"),
        },
    }
    
    return cfg, nil
}

func getEnv(key, defaultValue string) string {
    if value := os.Getenv(key); value != "" {
        return value
    }
    return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
    if value := os.Getenv(key); value != "" {
        if intValue, err := strconv.Atoi(value); err == nil {
            return intValue
        }
    }
    return defaultValue
}

func getEnvAsDuration(key string, defaultValue time.Duration) time.Duration {
    if value := os.Getenv(key); value != "" {
        if duration, err := time.ParseDuration(value); err == nil {
            return duration
        }
    }
    return defaultValue
}
```

### Rust配置管理
```rust
use config::{Config, ConfigError, Environment, File};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ServerConfig {
    pub port: u16,
    pub read_timeout: u64,  // seconds
    pub write_timeout: u64, // seconds
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub max_connections: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub db: u8,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LoggingConfig {
    pub level: String,
    pub format: String,
}

impl AppConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let mut config = Config::builder()
            // 默认配置
            .set_default("server.port", 8080)?
            .set_default("server.read_timeout", 10)?
            .set_default("server.write_timeout", 10)?
            .set_default("database.host", "localhost")?
            .set_default("database.port", 5432)?
            .set_default("database.max_connections", 10)?
            .set_default("redis.host", "localhost")?
            .set_default("redis.port", 6379)?
            .set_default("redis.db", 0)?
            .set_default("logging.level", "info")?
            .set_default("logging.format", "json")?;
        
        // 从配置文件加载
        if std::path::Path::new("config.toml").exists() {
            config = config.add_source(File::with_name("config"));
        }
        
        // 从环境变量加载
        config = config.add_source(
            Environment::with_prefix("APP")
                .separator("_")
                .try_parsing(true),
        );
        
        config.build()?.try_deserialize()
    }
    
    pub fn server_address(&self) -> String {
        format!("0.0.0.0:{}", self.server.port)
    }
    
    pub fn database_url(&self) -> String {
        format!(
            "postgresql://{}:{}@{}:{}/{}",
            self.database.user,
            self.database.password,
            self.database.host,
            self.database.port,
            self.database.database
        )
    }
}
```

## 健康检查

### Go健康检查
```go
package health

import (
    "context"
    "database/sql"
    "encoding/json"
    "net/http"
    "time"
    
    "github.com/go-redis/redis/v8"
)

type HealthChecker struct {
    db    *sql.DB
    redis *redis.Client
}

type HealthStatus struct {
    Status   string            `json:"status"`
    Version  string            `json:"version"`
    Checks   map[string]Check  `json:"checks"`
    Duration string            `json:"duration"`
}

type Check struct {
    Status  string `json:"status"`
    Message string `json:"message,omitempty"`
}

func NewHealthChecker(db *sql.DB, redis *redis.Client) *HealthChecker {
    return &HealthChecker{
        db:    db,
        redis: redis,
    }
}

func (hc *HealthChecker) Handler(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    
    status := HealthStatus{
        Status:  "healthy",
        Version: "1.0.0",
        Checks:  make(map[string]Check),
    }
    
    // 检查数据库
    if err := hc.checkDatabase(); err != nil {
        status.Status = "unhealthy"
        status.Checks["database"] = Check{
            Status:  "unhealthy",
            Message: err.Error(),
        }
    } else {
        status.Checks["database"] = Check{Status: "healthy"}
    }
    
    // 检查Redis
    if err := hc.checkRedis(); err != nil {
        status.Status = "unhealthy"
        status.Checks["redis"] = Check{
            Status:  "unhealthy",
            Message: err.Error(),
        }
    } else {
        status.Checks["redis"] = Check{Status: "healthy"}
    }
    
    status.Duration = time.Since(start).String()
    
    w.Header().Set("Content-Type", "application/json")
    if status.Status == "unhealthy" {
        w.WriteHeader(http.StatusServiceUnavailable)
    }
    
    json.NewEncoder(w).Encode(status)
}

func (hc *HealthChecker) checkDatabase() error {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    
    return hc.db.PingContext(ctx)
}

func (hc *HealthChecker) checkRedis() error {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    
    return hc.redis.Ping(ctx).Err()
}
```

### Rust健康检查
```rust
use warp::{Filter, Reply, Rejection};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use redis::Client as RedisClient;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Serialize)]
pub struct HealthStatus {
    status: String,
    version: String,
    checks: HashMap<String, Check>,
    duration_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct Check {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone)]
pub struct HealthChecker {
    db: PgPool,
    redis: RedisClient,
}

impl HealthChecker {
    pub fn new(db: PgPool, redis: RedisClient) -> Self {
        Self { db, redis }
    }
    
    pub async fn check_health(&self) -> HealthStatus {
        let start = Instant::now();
        let mut status = HealthStatus {
            status: "healthy".to_string(),
            version: "1.0.0".to_string(),
            checks: HashMap::new(),
            duration_ms: 0,
        };
        
        // 检查数据库
        match self.check_database().await {
            Ok(_) => {
                status.checks.insert("database".to_string(), Check {
                    status: "healthy".to_string(),
                    message: None,
                });
            }
            Err(e) => {
                status.status = "unhealthy".to_string();
                status.checks.insert("database".to_string(), Check {
                    status: "unhealthy".to_string(),
                    message: Some(e.to_string()),
                });
            }
        }
        
        // 检查Redis
        match self.check_redis().await {
            Ok(_) => {
                status.checks.insert("redis".to_string(), Check {
                    status: "healthy".to_string(),
                    message: None,
                });
            }
            Err(e) => {
                status.status = "unhealthy".to_string();
                status.checks.insert("redis".to_string(), Check {
                    status: "unhealthy".to_string(),
                    message: Some(e.to_string()),
                });
            }
        }
        
        status.duration_ms = start.elapsed().as_millis();
        status
    }
    
    async fn check_database(&self) -> Result<(), sqlx::Error> {
        sqlx::query("SELECT 1")
            .execute(&self.db)
            .await
            .map(|_| ())
    }
    
    async fn check_redis(&self) -> Result<(), redis::RedisError> {
        let mut conn = self.redis.get_async_connection().await?;
        redis::cmd("PING").query_async(&mut conn).await
    }
}

pub async fn health_handler(
    checker: HealthChecker,
) -> Result<impl Reply, Rejection> {
    let status = checker.check_health().await;
    
    if status.status == "healthy" {
        Ok(warp::reply::with_status(
            warp::reply::json(&status),
            warp::http::StatusCode::OK,
        ))
    } else {
        Ok(warp::reply::with_status(
            warp::reply::json(&status),
            warp::http::StatusCode::SERVICE_UNAVAILABLE,
        ))
    }
}

pub fn health_routes(
    checker: HealthChecker,
) -> impl Filter<Extract = impl Reply, Error = Rejection> + Clone {
    warp::path("health")
        .and(warp::get())
        .and(warp::any().map(move || checker.clone()))
        .and_then(health_handler)
}
```

## 完整项目结构

### Rust微服务项目结构
```
user-service/
├── Cargo.toml
├── Dockerfile
├── config.toml
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── config/
│   │   └── mod.rs
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── user.rs
│   │   └── health.rs
│   ├── models/
│   │   ├── mod.rs
│   │   └── user.rs
│   ├── services/
│   │   ├── mod.rs
│   │   └── user_service.rs
│   ├── repository/
│   │   ├── mod.rs
│   │   └── user_repository.rs
│   ├── middleware/
│   │   ├── mod.rs
│   │   ├── auth.rs
│   │   └── logging.rs
│   └── utils/
│       ├── mod.rs
│       └── database.rs
├── migrations/
│   └── 001_create_users.sql
└── tests/
    ├── integration_tests.rs
    └── common/
        └── mod.rs
```

### Cargo.toml示例
```toml
[package]
name = "user-service"
version = "0.1.0"
edition = "2021"

[dependencies]
# Web framework
warp = "0.3"
tokio = { version = "1.0", features = ["full"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Database
sqlx = { version = "0.7", features = ["runtime-tokio-rustls", "postgres", "uuid", "chrono"] }

# Configuration
config = "0.13"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Error handling
anyhow = "1.0"
thiserror = "1.0"

# Validation
validator = { version = "0.16", features = ["derive"] }

# Time
chrono = { version = "0.4", features = ["serde"] }

# UUID
uuid = { version = "1.0", features = ["v4", "serde"] }

# HTTP client
reqwest = { version = "0.11", features = ["json"] }

# Metrics
prometheus = "0.13"

# Redis
redis = { version = "0.23", features = ["tokio-comp"] }

[dev-dependencies]
tokio-test = "0.4"
```

## 部署策略

### Docker部署
```dockerfile
# Rust微服务Dockerfile
FROM rust:1.70 as builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/user-service ./
COPY config.toml ./

EXPOSE 8080

CMD ["./user-service"]
```

### Kubernetes部署
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
      - name: user-service
        image: user-service:latest
        ports:
        - containerPort: 8080
        env:
        - name: APP_DATABASE_HOST
          value: "postgres-service"
        - name: APP_REDIS_HOST
          value: "redis-service"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: user-service
spec:
  selector:
    app: user-service
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
```

## 关键要点

1. **Rust微服务具有优异的性能和内存安全性**
2. **配置管理使用结构化的方式**
3. **健康检查是微服务的重要组成部分**
4. **项目结构清晰有助于维护**
5. **容器化部署简化了运维复杂度**

## 🔗 下一章

继续学习 [第14章：gRPC服务开发](../14-grpc/README.md)