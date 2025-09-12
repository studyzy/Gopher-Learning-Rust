# 第2章：内存管理：垃圾回收 vs 所有权

本章将深入对比Go的垃圾回收机制和Rust的所有权系统，这是两种语言最核心的差异之一。

## 📖 目录
- [内存管理概述](#内存管理概述)
- [所有权系统](#所有权系统)
- [借用与引用](#借用与引用)
- [生命周期](#生命周期)
- [智能指针](#智能指针)
- [实践示例](#实践示例)
- [练习](#练习)

## 内存管理概述

### Go的垃圾回收
```go
func createSlice() []int {
    // 在堆上分配内存
    slice := make([]int, 1000)
    return slice
    // GC会在适当时候回收内存
}

func main() {
    data := createSlice()
    // 使用data...
    // 当data不再被引用时，GC会回收内存
}
```

**Go内存管理特点：**
- 自动垃圾回收
- 运行时开销
- 可能有暂停时间
- 简单的内存模型

### Rust的所有权系统
```rust
fn create_vector() -> Vec<i32> {
    // 在堆上分配内存
    let vec = vec![0; 1000];
    vec
    // 所有权转移，函数结束时不会释放内存
}

fn main() {
    let data = create_vector();
    // 使用data...
    // 当data离开作用域时，内存立即释放
}
```

**Rust内存管理特点：**
- 编译时保证内存安全
- 零运行时开销
- 确定性内存释放
- 所有权系统

## 所有权系统

### 所有权规则

1. **每个值都有一个所有者**
2. **同时只能有一个所有者**
3. **当所有者离开作用域时，值会被释放**

### 移动语义

#### Go（引用语义）
```go
func main() {
    slice1 := []int{1, 2, 3}
    slice2 := slice1  // 复制引用，共享底层数组
    
    slice2[0] = 100
    fmt.Println(slice1[0])  // 输出: 100（被修改了）
}
```

#### Rust（移动语义）
```rust
fn main() {
    let vec1 = vec![1, 2, 3];
    let vec2 = vec1;  // 所有权移动
    
    // println!("{:?}", vec1);  // 编译错误！vec1不再有效
    println!("{:?}", vec2);   // 正确
}
```

### 克隆

```rust
fn main() {
    let vec1 = vec![1, 2, 3];
    let vec2 = vec1.clone();  // 显式克隆
    
    println!("{:?}", vec1);   // 正确
    println!("{:?}", vec2);   // 正确
}
```

## 借用与引用

### 不可变借用

#### Go
```go
func readSlice(s []int) int {
    return s[0]  // 可以读取
}

func main() {
    data := []int{1, 2, 3}
    value := readSlice(data)
    fmt.Println(value)
    fmt.Println(data)  // data仍然可用
}
```

#### Rust
```rust
fn read_vector(v: &Vec<i32>) -> i32 {
    v[0]  // 可以读取
}

fn main() {
    let data = vec![1, 2, 3];
    let value = read_vector(&data);  // 借用
    println!("{}", value);
    println!("{:?}", data);  // data仍然可用
}
```

### 可变借用

#### Go
```go
func modifySlice(s []int) {
    s[0] = 100  // 可以修改
}

func main() {
    data := []int{1, 2, 3}
    modifySlice(data)
    fmt.Println(data)  // [100, 2, 3]
}
```

#### Rust
```rust
fn modify_vector(v: &mut Vec<i32>) {
    v[0] = 100;  // 可以修改
}

fn main() {
    let mut data = vec![1, 2, 3];
    modify_vector(&mut data);  // 可变借用
    println!("{:?}", data);  // [100, 2, 3]
}
```

### 借用规则

1. **任意数量的不可变借用** 或 **一个可变借用**
2. **借用必须有效**

```rust
fn main() {
    let mut data = vec![1, 2, 3];
    
    let r1 = &data;      // 不可变借用
    let r2 = &data;      // 多个不可变借用 - 正确
    // let r3 = &mut data;  // 编译错误！不能同时有可变和不可变借用
    
    println!("{:?} {:?}", r1, r2);
    
    let r3 = &mut data;  // 现在可以了，r1和r2不再使用
    r3.push(4);
}
```

## 生命周期

### 生命周期注解

当Rust无法推断引用的生命周期时，需要显式标注：

```rust
// 返回两个字符串切片中较长的一个
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() {
        x
    } else {
        y
    }
}

fn main() {
    let string1 = String::from("long string is long");
    {
        let string2 = String::from("xyz");
        let result = longest(string1.as_str(), string2.as_str());
        println!("The longest string is {}", result);
    }
}
```

### 与Go的对比

Go中不需要显式管理生命周期：

```go
func longest(x, y string) string {
    if len(x) > len(y) {
        return x
    }
    return y
}
// GC会处理内存管理
```

## 智能指针

### Box<T> - 堆分配

```rust
fn main() {
    // 在堆上分配一个i32
    let boxed = Box::new(42);
    println!("{}", boxed);
    
    // 递归类型必须使用Box
    enum List {
        Cons(i32, Box<List>),
        Nil,
    }
}
```

### Rc<T> - 引用计数

```rust
use std::rc::Rc;

fn main() {
    let data = Rc::new(vec![1, 2, 3]);
    let data1 = Rc::clone(&data);  // 增加引用计数
    let data2 = Rc::clone(&data);
    
    println!("引用计数: {}", Rc::strong_count(&data));  // 输出: 3
}
```

### RefCell<T> - 内部可变性

```rust
use std::cell::RefCell;
use std::rc::Rc;

fn main() {
    let data = Rc::new(RefCell::new(vec![1, 2, 3]));
    let data1 = Rc::clone(&data);
    
    // 运行时借用检查
    data1.borrow_mut().push(4);
    println!("{:?}", data.borrow());
}
```

## 实践示例

### 字符串处理对比

#### Go版本
```go
package main

import (
    "fmt"
    "strings"
)

func processStrings(texts []string) []string {
    var result []string
    for _, text := range texts {
        if len(text) > 5 {
            result = append(result, strings.ToUpper(text))
        }
    }
    return result
}

func main() {
    input := []string{"hello", "world", "golang", "rust"}
    output := processStrings(input)
    fmt.Println(output)
}
```

#### Rust版本
```rust
fn process_strings(texts: &[String]) -> Vec<String> {
    texts
        .iter()
        .filter(|text| text.len() > 5)
        .map(|text| text.to_uppercase())
        .collect()
}

fn main() {
    let input = vec![
        String::from("hello"),
        String::from("world"),
        String::from("golang"),
        String::from("rust"),
    ];
    let output = process_strings(&input);
    println!("{:?}", output);
}
```

## 练习

### 练习1：理解所有权
创建一个函数，接受一个Vec<i32>并返回其和。用三种方式实现：
1. 获取所有权
2. 不可变借用
3. 可变借用（修改原Vec，然后返回和）

### 练习2：生命周期实践
实现一个函数，找到字符串Vec中最长的字符串，并返回它的引用。

### 练习3：智能指针
创建一个简单的链表数据结构，使用适当的智能指针。

## 关键要点

1. **Go使用垃圾回收器自动管理内存，简单但有运行时开销**
2. **Rust使用所有权系统在编译时保证内存安全，零运行时开销**
3. **理解借用规则是掌握Rust的关键**
4. **生命周期注解帮助编译器理解引用的有效期**
5. **智能指针提供了灵活的内存管理方案**

## 🔗 下一章

继续学习 [第3章：错误处理：Error vs Result](../03-error-handling/README.md)