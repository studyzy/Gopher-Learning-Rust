// Todo API服务 - 展示工业级Rust后端服务实现
use warp::Filter;
use std::sync::Arc;

mod config;
mod handlers;
mod models;
mod services;

use config::AppConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt::init();
    
    // 加载配置
    let config = AppConfig::new()?;
    tracing::info!("Starting todo-api-rust on {}", config.server_address());
    
    // 创建应用状态
    let app_state = Arc::new(services::AppState::new(config).await?);
    
    // 定义路由
    let api_routes = handlers::routes(app_state.clone());
    
    // 添加CORS和日志中间件
    let routes = api_routes
        .with(warp::cors().allow_any_origin().allow_any_method().allow_any_header())
        .with(warp::log("api"));
    
    // 启动服务器
    warp::serve(routes)
        .run(([0, 0, 0, 0], app_state.config.server.port))
        .await;
    
    Ok(())
}