# 4. 集合与字符串：所有权在实战中的应用

本章把第3章的所有权/借用/生命周期应用到标准集合和字符串处理上，帮助 Go 开发者在日常后端场景中写出高性能、安全的 Rust 代码。

目录：
- String 与 &str：堆分配、切片、拼接与性能
- Vec<T> 与切片：增长、重分配与借用规则
- HashMap/HashSet：键值所有权、借用查询与 Entry API
- 迭代器与所有权：into_iter/iter/iter_mut 的差异
- 并发容器：Arc、Mutex、RwLock 的组合模式
- 常见坑位与性能建议

---

## 4.1 String 与 &str

概念对照：
- Go: string 是只读的字节序列，底层与切片相似（指针+len）。
- Rust: `String` 拥有堆内存、可变；`&str` 是只读视图（切片），不拥有数据。

构造与切片

```rust
fn main() {
    let mut s = String::from("hello");
    s.push_str(", world");   // 追加
    let view: &str = &s;     // &str 视图，不拷贝
    println!("{view}");
}
```

避免 UTF-8 边界错误
- Rust 字符串是 UTF-8，`s[i]` 不存在；可用切片在合法边界上：

```rust
fn first_char(s: &str) -> &str {
    let mut it = s.char_indices();
    let (_, start) = it.next().unwrap();
    let (end, _) = it.next().map_or((s.len(), ' '), |(i, ch)| (i, ch));
    &s[start..end]
}
```

拼接与所有权
- `String + &str` 会 move 左侧的 String，返回新的 String。

```rust
fn main() {
    let a = String::from("Go");
    let b = "->Rust";
    let c = a + b;     // a 被 move，c 拥有新字符串
    // println!("{a}"); // 错误：a 已被 move
    println!("{c}");
}
```

使用 format! 避免多次分配或 move

```rust
fn main() {
    let lang = "Rust";
    let s = format!("Hello, {lang}!"); // 不消耗入参与更可读
    println!("{s}");
}
```

避免不必要的 clone
- 首选借用 `&str` 参数，调用方用 `&s` 即可。需要所有权再显式 `to_string()`。

---

## 4.2 Vec<T> 与切片

增长与重分配
- `Vec<T>` 可能在 `push` 时重分配，导致现有引用失效；与第3章的借用规则一致。

```rust
fn main() {
    let mut v = vec![1, 2, 3];
    let r = &v[0];          // 不可变借用元素
    // v.push(4);           // 可能重分配 -> 编译拒绝：同时借用与变更
    println!("{r}");
}
```

切片 `&[T]` 的只读视图

```rust
fn sum(slice: &[i64]) -> i64 {
    slice.iter().copied().sum()
}

fn main() {
    let v = vec![1,2,3,4];
    let s = &v[1..3]; // &[i32]
    println!("{}", sum(s));
}
```

原地修改与独占可变借用

```rust
fn add_one_all(v: &mut [i32]) {
    for x in v.iter_mut() {
        *x += 1;
    }
}

fn main() {
    let mut v = vec![1,2,3];
    add_one_all(&mut v);   // &mut [i32]
    println!("{:?}", v);
}
```

容量管理与性能
- 预分配：`Vec::with_capacity(n)` 减少重分配。
- 扩容策略按倍数增长，吞吐敏感路径注意 `reserve`。

---

## 4.3 HashMap/HashSet：所有权与借用

基础用法

```rust
use std::collections::HashMap;

fn main() {
    let mut m: HashMap<String, i32> = HashMap::new();
    m.insert("hits".to_string(), 1);
    m.entry("hits".to_string()).and_modify(|v| *v += 1).or_insert(1);
    println!("{:?}", m);
}
```

键/值的所有权
- `insert` 会取得键和值的所有权（move）。
- 查找可借用键以避免分配：`get(&str)` 通过 `Borrow` 适配。

```rust
use std::collections::HashMap;

fn main() {
    let mut m: HashMap<String, i32> = HashMap::new();
    m.insert("user:1".into(), 10);

    // 使用 &str 查询，避免创建临时 String
    if let Some(score) = m.get("user:1") {
        println!("{score}");
    }
}
```

Entry API 避免双查找

```rust
use std::collections::hash_map::Entry;

fn bump(m: &mut HashMap<String, i64>, key: &str, delta: i64) {
    match m.entry(key.to_string()) {
        Entry::Occupied(mut e) => *e.get_mut() += delta,
        Entry::Vacant(e) => { e.insert(delta); }
    }
}
```

自定义键的 Borrow 查询

```rust
use std::collections::HashMap;
use std::borrow::Borrow;

#[derive(Hash, Eq, PartialEq)]
struct UserId(String);

impl Borrow<str> for UserId {
    fn borrow(&self) -> &str { &self.0 }
}

fn main() {
    let mut m: HashMap<UserId, i32> = HashMap::new();
    m.insert(UserId("42".into()), 7);
    // 直接用 &str 查询
    println!("{:?}", m.get("42"));
}
```

---

## 4.4 迭代器与所有权

三种迭代方式差异：
- `into_iter()` 消耗集合，元素被 move 出来，适合生成新集合或转移所有权。
- `iter()` 借用为 `&T`，只读遍历。
- `iter_mut()` 借用为 `&mut T`，可原地修改。

示例

```rust
fn main() {
    let v = vec!["a".to_string(), "b".to_string()];

    // into_iter: 消耗 v
    for s in v.clone().into_iter() {
        println!("{s}");
    }

    // iter: 只读借用
    for s in v.iter() {
        println!("{}", s.len());
    }

    // iter_mut: 原地修改
    let mut v2 = v.clone();
    for s in v2.iter_mut() {
        s.push('x');
    }
    println!("{:?}", v2);
}
```

迭代器链的零成本抽象

```rust
fn sum_even(v: &[i32]) -> i32 {
    v.iter().copied().filter(|x| x % 2 == 0).sum()
}
```

---

## 4.5 并发容器：Arc、Mutex、RwLock

Go 中通过 goroutine + channel/mutex 管理共享。Rust 的并发需要类型是 `Send/Sync`，跨线程共享所有权通常用 `Arc<T>`，可变共享配合 `Mutex`/`RwLock`。

计数器示例：Arc + Mutex

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0i64));
    let mut handles = vec![];

    for _ in 0..4 {
        let c = Arc::clone(&counter);
        handles.push(thread::spawn(move || {
            for _ in 0..100_000 {
                *c.lock().unwrap() += 1;
            }
        }));
    }

    for h in handles { h.join().unwrap(); }
    println!("count = {}", *counter.lock().unwrap());
}
```

读多写少：Arc + RwLock

```rust
use std::sync::{Arc, RwLock};
use std::thread;

fn main() {
    let store = Arc::new(RwLock::new(vec![1,2,3]));
    let r1 = store.clone();
    let r2 = store.clone();

    let t1 = thread::spawn(move || {
        let data = r1.read().unwrap();
        data.iter().sum::<i32>()
    });

    let t2 = thread::spawn(move || {
        let mut data = r2.write().unwrap();
        data.push(4);
    });

    t1.join().unwrap();
    t2.join().unwrap();
}
```

避免锁的长持有与死锁
- 将计算放在临界区外，`let x = { let mut g = lock.lock()?; ...; }` 缩短 guard 生命周期。
- 谨慎多锁顺序，必要时采用分层或尝试锁 `try_lock`。

单线程内部可变性
- `RefCell<T>` 在运行时检查借用规则，违规则 panic，适用于无需跨线程的场景（例如树结构的父指针）。

---

## 4.6 常见坑位与性能建议

- 字符串拼接优先 `format!` 或 `String::with_capacity` 预分配，避免重复重分配。
- 对 `Vec` 批量构建使用 `with_capacity`/`reserve`。
- Map 访问路径用 `entry` 降低哈希两次计算与查找。
- 迭代器链注意临时分配：`map(|s: String| ...)` 会 move 所有权；只读用 `&str`/`&T`。
- 并发下尽量减小锁粒度与持锁时间；读多写少考虑 `RwLock`，跨核扩展考虑分片 sharding。

---

## 4.7 练习

1) 在不 clone 键的前提下，统计字符串切片数组中各单词出现次数，返回 `HashMap<String, usize>`。

提示：遍历 `&str`，`entry(word.to_string())` 累加。

2) 实现一个函数，接收 `&mut String` 与 `&str`，若目标未以该后缀结尾则追加该后缀。

签名建议：
```rust
fn ensure_suffix(buf: &mut String, suf: &str)
```

3) 用 `Arc<RwLock<HashMap<String,i64>>>` 实现并发安全的计数器，提供 `inc(key)` 与 `get(key) -> i64`。

---

## 4.8 小结

- String/&str：拥有 vs 视图，拼接 move 语义，可用 format! 和预分配优化。
- Vec/&[T]：增长或变更可能重分配，注意借用与作用域；原地修改用 `iter_mut`。
- HashMap：插入 move，查询可借用键；Entry API 高效改写。
- 迭代器：into_iter/iter/iter_mut 控制所有权流动。
- 并发：Arc 管理共享所有权，Mutex/RwLock 管控可变共享，缩短持锁范围提高吞吐。

掌握本章，你可以在不牺牲安全的前提下写出高效的集合与字符串处理代码，并在并发场景下做出正确的所有权设计权衡。