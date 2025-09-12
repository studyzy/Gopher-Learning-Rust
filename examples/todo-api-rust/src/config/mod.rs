use config::{Config, ConfigError, Environment};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ServerConfig {
    pub port: u16,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
}

impl AppConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let config = Config::builder()
            // 默认配置
            .set_default("server.port", 3000)?
            .set_default("database.url", "postgresql://localhost/todoapp")?
            .set_default("database.max_connections", 10)?
            // 从环境变量加载
            .add_source(
                Environment::with_prefix("TODO_API")
                    .separator("_")
                    .try_parsing(true),
            )
            .build()?;
        
        config.try_deserialize()
    }
    
    pub fn server_address(&self) -> String {
        format!("0.0.0.0:{}", self.server.port)
    }
}