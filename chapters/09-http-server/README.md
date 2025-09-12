# 第9章：构建HTTP服务器

本章将对比Go和Rust构建HTTP服务器的方法，从基础到高级特性，帮助你快速上手Rust的Web开发。

## 📖 目录
- [HTTP服务器基础](#http服务器基础)
- [路由处理](#路由处理)
- [JSON处理](#json处理)
- [中间件](#中间件)
- [状态管理](#状态管理)
- [完整示例](#完整示例)
- [性能对比](#性能对比)
- [练习](#练习)

## HTTP服务器基础

### Go标准库
```go
package main

import (
    "fmt"
    "log"
    "net/http"
)

func helloHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello, World!")
}

func main() {
    http.HandleFunc("/", helloHandler)
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

### Rust + Tokio + Warp
```rust
use warp::Filter;

#[tokio::main]
async fn main() {
    // 创建路由
    let hello = warp::path::end()
        .map(|| "Hello, World!");

    println!("Server starting on 127.0.0.1:8080");
    warp::serve(hello)
        .run(([127, 0, 0, 1], 8080))
        .await;
}
```

### Rust + Actix-Web
```rust
use actix_web::{web, App, HttpResponse, HttpServer, Result};

async fn hello() -> Result<HttpResponse> {
    Ok(HttpResponse::Ok().body("Hello, World!"))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("Server starting on 127.0.0.1:8080");
    
    HttpServer::new(|| {
        App::new()
            .route("/", web::get().to(hello))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
```

## 路由处理

### Go + Gorilla Mux
```go
package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    
    "github.com/gorilla/mux"
)

type User struct {
    ID   string `json:"id"`
    Name string `json:"name"`
}

var users = map[string]User{
    "1": {ID: "1", Name: "Alice"},
    "2": {ID: "2", Name: "Bob"},
}

func getUser(w http.ResponseWriter, r *http.Request) {
    vars := mux.Vars(r)
    id := vars["id"]
    
    user, exists := users[id]
    if !exists {
        http.Error(w, "User not found", http.StatusNotFound)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(user)
}

func createUser(w http.ResponseWriter, r *http.Request) {
    var user User
    if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }
    
    users[user.ID] = user
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}

func main() {
    r := mux.NewRouter()
    r.HandleFunc("/users/{id}", getUser).Methods("GET")
    r.HandleFunc("/users", createUser).Methods("POST")
    
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", r))
}
```

### Rust + Warp
```rust
use warp::{Filter, Rejection, Reply, reject};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Deserialize, Serialize, Clone)]
struct User {
    id: String,
    name: String,
}

type Users = Arc<RwLock<HashMap<String, User>>>;

async fn get_user(id: String, users: Users) -> Result<impl Reply, Rejection> {
    let users_map = users.read().await;
    match users_map.get(&id) {
        Some(user) => Ok(warp::reply::json(user)),
        None => Err(reject::not_found()),
    }
}

async fn create_user(user: User, users: Users) -> Result<impl Reply, Rejection> {
    let mut users_map = users.write().await;
    users_map.insert(user.id.clone(), user.clone());
    Ok(warp::reply::with_status(warp::reply::json(&user), warp::http::StatusCode::CREATED))
}

#[tokio::main]
async fn main() {
    let users: Users = Arc::new(RwLock::new(HashMap::new()));
    
    let users_filter = warp::any().map(move || users.clone());
    
    let get_user_route = warp::path!("users" / String)
        .and(warp::get())
        .and(users_filter.clone())
        .and_then(get_user);
    
    let create_user_route = warp::path("users")
        .and(warp::post())
        .and(warp::body::json())
        .and(users_filter)
        .and_then(create_user);
    
    let routes = get_user_route.or(create_user_route);
    
    println!("Server starting on 127.0.0.1:8080");
    warp::serve(routes)
        .run(([127, 0, 0, 1], 8080))
        .await;
}
```

## JSON处理

### Go JSON处理
```go
type CreateUserRequest struct {
    Name  string `json:"name" validate:"required"`
    Email string `json:"email" validate:"required,email"`
    Age   int    `json:"age" validate:"min=0,max=120"`
}

type UserResponse struct {
    ID    string `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
    Age   int    `json:"age"`
}

func createUserHandler(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    
    // 解析JSON
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }
    
    // 验证（使用validator库）
    if err := validate.Struct(req); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    
    // 创建用户
    user := UserResponse{
        ID:    generateID(),
        Name:  req.Name,
        Email: req.Email,
        Age:   req.Age,
    }
    
    // 返回JSON响应
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}
```

### Rust JSON处理
```rust
use serde::{Deserialize, Serialize};
use validator::{Validate, ValidationError};

#[derive(Debug, Deserialize, Validate)]
struct CreateUserRequest {
    #[validate(length(min = 1, message = "Name is required"))]
    name: String,
    
    #[validate(email(message = "Invalid email format"))]
    email: String,
    
    #[validate(range(min = 0, max = 120, message = "Age must be between 0 and 120"))]
    age: u8,
}

#[derive(Debug, Serialize)]
struct UserResponse {
    id: String,
    name: String,
    email: String,
    age: u8,
}

async fn create_user_handler(
    req: CreateUserRequest,
) -> Result<impl Reply, Rejection> {
    // 验证请求
    if let Err(errors) = req.validate() {
        return Err(warp::reject::custom(ValidationError::new(&errors.to_string())));
    }
    
    // 创建用户
    let user = UserResponse {
        id: generate_id(),
        name: req.name,
        email: req.email,
        age: req.age,
    };
    
    Ok(warp::reply::with_status(
        warp::reply::json(&user),
        warp::http::StatusCode::CREATED,
    ))
}

// 在路由中使用
let create_user_route = warp::path("users")
    .and(warp::post())
    .and(warp::body::json())
    .and_then(create_user_handler);
```

## 中间件

### Go中间件
```go
// 日志中间件
func loggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        duration := time.Since(start)
        log.Printf("%s %s %v", r.Method, r.URL.Path, duration)
    })
}

// CORS中间件
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        
        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusOK)
            return
        }
        
        next.ServeHTTP(w, r)
    })
}

// 使用中间件
func main() {
    r := mux.NewRouter()
    // 添加路由...
    
    // 应用中间件
    handler := corsMiddleware(loggingMiddleware(r))
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```

### Rust Warp中间件
```rust
use warp::{Filter, Reply};
use std::time::Instant;

// 日志中间件
fn with_logging() -> impl Filter<Extract = (), Error = std::convert::Infallible> + Clone {
    warp::log::custom(|info| {
        println!(
            "{} {} {} {:?}",
            info.method(),
            info.path(),
            info.status(),
            info.elapsed(),
        );
    })
}

// CORS中间件
fn with_cors() -> impl Filter<Extract = (), Error = std::convert::Infallible> + Clone {
    warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type", "authorization"])
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
}

// 认证中间件
fn with_auth() -> impl Filter<Extract = (String,), Error = warp::Rejection> + Clone {
    warp::header::<String>("authorization")
        .and_then(|token: String| async move {
            if token.starts_with("Bearer ") {
                Ok(token[7..].to_string())
            } else {
                Err(warp::reject::custom(AuthError))
            }
        })
}

#[tokio::main]
async fn main() {
    let api = warp::path("api")
        .and(get_user_route.or(create_user_route))
        .with(with_cors())
        .with(with_logging());
    
    warp::serve(api)
        .run(([127, 0, 0, 1], 8080))
        .await;
}
```

## 状态管理

### Go状态管理
```go
type Server struct {
    db    *sql.DB
    cache *redis.Client
    users map[string]User
    mu    sync.RWMutex
}

func NewServer() *Server {
    return &Server{
        users: make(map[string]User),
    }
}

func (s *Server) GetUser(w http.ResponseWriter, r *http.Request) {
    vars := mux.Vars(r)
    id := vars["id"]
    
    s.mu.RLock()
    user, exists := s.users[id]
    s.mu.RUnlock()
    
    if !exists {
        http.Error(w, "User not found", http.StatusNotFound)
        return
    }
    
    json.NewEncoder(w).Encode(user)
}

func main() {
    server := NewServer()
    
    r := mux.NewRouter()
    r.HandleFunc("/users/{id}", server.GetUser).Methods("GET")
    
    log.Fatal(http.ListenAndServe(":8080", r))
}
```

### Rust状态管理
```rust
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::PgPool;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    users: Arc<RwLock<HashMap<String, User>>>,
}

impl AppState {
    fn new(db: PgPool) -> Self {
        Self {
            db,
            users: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

async fn get_user(
    id: String,
    state: AppState,
) -> Result<impl Reply, Rejection> {
    let users = state.users.read().await;
    match users.get(&id) {
        Some(user) => Ok(warp::reply::json(user)),
        None => Err(warp::reject::not_found()),
    }
}

fn with_state(
    state: AppState,
) -> impl Filter<Extract = (AppState,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || state.clone())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = PgPool::connect("postgresql://localhost/mydb").await?;
    let state = AppState::new(db);
    
    let get_user_route = warp::path!("users" / String)
        .and(warp::get())
        .and(with_state(state))
        .and_then(get_user);
    
    warp::serve(get_user_route)
        .run(([127, 0, 0, 1], 8080))
        .await;
    
    Ok(())
}
```

## 完整示例

### Todo API对比

#### Go版本
```go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "strconv"
    "sync"
    "time"
    
    "github.com/gorilla/mux"
)

type Todo struct {
    ID          int       `json:"id"`
    Title       string    `json:"title"`
    Description string    `json:"description"`
    Completed   bool      `json:"completed"`
    CreatedAt   time.Time `json:"created_at"`
}

type TodoStore struct {
    todos   map[int]Todo
    nextID  int
    mu      sync.RWMutex
}

func NewTodoStore() *TodoStore {
    return &TodoStore{
        todos:  make(map[int]Todo),
        nextID: 1,
    }
}

func (ts *TodoStore) CreateTodo(title, description string) Todo {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    
    todo := Todo{
        ID:          ts.nextID,
        Title:       title,
        Description: description,
        Completed:   false,
        CreatedAt:   time.Now(),
    }
    
    ts.todos[ts.nextID] = todo
    ts.nextID++
    
    return todo
}

func (ts *TodoStore) GetTodos() []Todo {
    ts.mu.RLock()
    defer ts.mu.RUnlock()
    
    todos := make([]Todo, 0, len(ts.todos))
    for _, todo := range ts.todos {
        todos = append(todos, todo)
    }
    
    return todos
}

func main() {
    store := NewTodoStore()
    
    r := mux.NewRouter()
    
    r.HandleFunc("/todos", func(w http.ResponseWriter, r *http.Request) {
        if r.Method == "GET" {
            todos := store.GetTodos()
            w.Header().Set("Content-Type", "application/json")
            json.NewEncoder(w).Encode(todos)
        } else if r.Method == "POST" {
            var req struct {
                Title       string `json:"title"`
                Description string `json:"description"`
            }
            
            if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                http.Error(w, "Invalid JSON", http.StatusBadRequest)
                return
            }
            
            todo := store.CreateTodo(req.Title, req.Description)
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusCreated)
            json.NewEncoder(w).Encode(todo)
        }
    })
    
    log.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", r))
}
```

#### Rust版本
```rust
use warp::{Filter, Reply, Rejection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Clone)]
struct Todo {
    id: u32,
    title: String,
    description: String,
    completed: bool,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct CreateTodoRequest {
    title: String,
    description: String,
}

#[derive(Clone)]
struct TodoStore {
    todos: Arc<RwLock<HashMap<u32, Todo>>>,
    next_id: Arc<RwLock<u32>>,
}

impl TodoStore {
    fn new() -> Self {
        Self {
            todos: Arc::new(RwLock::new(HashMap::new())),
            next_id: Arc::new(RwLock::new(1)),
        }
    }
    
    async fn create_todo(&self, title: String, description: String) -> Todo {
        let mut next_id = self.next_id.write().await;
        let mut todos = self.todos.write().await;
        
        let todo = Todo {
            id: *next_id,
            title,
            description,
            completed: false,
            created_at: Utc::now(),
        };
        
        todos.insert(*next_id, todo.clone());
        *next_id += 1;
        
        todo
    }
    
    async fn get_todos(&self) -> Vec<Todo> {
        let todos = self.todos.read().await;
        todos.values().cloned().collect()
    }
}

async fn get_todos(store: TodoStore) -> Result<impl Reply, Rejection> {
    let todos = store.get_todos().await;
    Ok(warp::reply::json(&todos))
}

async fn create_todo(
    req: CreateTodoRequest,
    store: TodoStore,
) -> Result<impl Reply, Rejection> {
    let todo = store.create_todo(req.title, req.description).await;
    Ok(warp::reply::with_status(
        warp::reply::json(&todo),
        warp::http::StatusCode::CREATED,
    ))
}

fn with_store(
    store: TodoStore,
) -> impl Filter<Extract = (TodoStore,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || store.clone())
}

#[tokio::main]
async fn main() {
    let store = TodoStore::new();
    
    let get_todos_route = warp::path("todos")
        .and(warp::get())
        .and(with_store(store.clone()))
        .and_then(get_todos);
    
    let create_todo_route = warp::path("todos")
        .and(warp::post())
        .and(warp::body::json())
        .and(with_store(store))
        .and_then(create_todo);
    
    let routes = get_todos_route
        .or(create_todo_route)
        .with(warp::cors().allow_any_origin());
    
    println!("Server starting on 127.0.0.1:8080");
    warp::serve(routes)
        .run(([127, 0, 0, 1], 8080))
        .await;
}
```

## 性能对比

### 内存使用
- **Go**: 垃圾回收，内存使用可能波动
- **Rust**: 零成本抽象，内存使用更可预测

### 并发性能
- **Go**: Goroutines，适合大量并发连接
- **Rust**: Async/await，更高的吞吐量

### 启动时间
- **Go**: 较快的编译和启动
- **Rust**: 编译较慢，但运行时性能更好

## 练习

### 练习1：基础API
创建一个用户管理API，支持CRUD操作。

### 练习2：中间件实现
添加认证、日志和错误处理中间件。

### 练习3：数据库集成
集成PostgreSQL数据库，实现数据持久化。

## 关键要点

1. **Rust的异步HTTP服务器性能优异**
2. **类型安全的JSON处理**
3. **强大的中间件系统**
4. **Arc<RwLock<T>>用于安全的状态共享**
5. **编译时保证的并发安全**

## 🔗 下一章

继续学习 [第10章：数据库集成与ORM](../10-database/README.md)