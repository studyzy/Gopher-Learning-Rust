# 第3章：错误处理：Error vs Result

本章将对比Go和Rust的错误处理机制，帮助你从Go的错误处理思维转换到Rust的Result类型系统。

## 📖 目录
- [错误处理哲学](#错误处理哲学)
- [Go的错误处理](#go的错误处理)
- [Rust的Result类型](#rust的result类型)
- [错误传播](#错误传播)
- [自定义错误类型](#自定义错误类型)
- [错误处理最佳实践](#错误处理最佳实践)
- [实践示例](#实践示例)
- [练习](#练习)

## 错误处理哲学

### Go的理念
- 错误是值，显式处理
- 使用多返回值
- 简单直接的错误检查

### Rust的理念
- 错误是类型，编译时保证
- 使用Result枚举
- 函数式错误处理

## Go的错误处理

### 基础错误处理
```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

// 返回错误的函数
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// 处理错误
func parseAndDivide(aStr, bStr string) (int, error) {
    a, err := strconv.Atoi(aStr)
    if err != nil {
        return 0, fmt.Errorf("failed to parse a: %w", err)
    }
    
    b, err := strconv.Atoi(bStr)
    if err != nil {
        return 0, fmt.Errorf("failed to parse b: %w", err)
    }
    
    result, err := divide(a, b)
    if err != nil {
        return 0, fmt.Errorf("division failed: %w", err)
    }
    
    return result, nil
}
```

### 错误包装和解包
```go
import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("item not found")

func findItem(id string) error {
    // 模拟查找失败
    return fmt.Errorf("failed to find item %s: %w", id, ErrNotFound)
}

func main() {
    err := findItem("123")
    if err != nil {
        // 检查是否是特定错误
        if errors.Is(err, ErrNotFound) {
            fmt.Println("Item not found")
        }
        fmt.Printf("Error: %v\n", err)
    }
}
```

## Rust的Result类型

### Result枚举定义
```rust
enum Result<T, E> {
    Ok(T),    // 成功，包含值
    Err(E),   // 失败，包含错误
}
```

### 基础错误处理
```rust
fn divide(a: i32, b: i32) -> Result<i32, String> {
    if b == 0 {
        Err(String::from("division by zero"))
    } else {
        Ok(a / b)
    }
}

fn parse_and_divide(a_str: &str, b_str: &str) -> Result<i32, String> {
    let a = a_str.parse::<i32>()
        .map_err(|e| format!("failed to parse a: {}", e))?;
    
    let b = b_str.parse::<i32>()
        .map_err(|e| format!("failed to parse b: {}", e))?;
    
    divide(a, b)
        .map_err(|e| format!("division failed: {}", e))
}

fn main() {
    match parse_and_divide("10", "2") {
        Ok(result) => println!("Result: {}", result),
        Err(e) => println!("Error: {}", e),
    }
}
```

### Result的方法

```rust
fn main() {
    let result: Result<i32, String> = Ok(42);
    
    // unwrap: 获取值或panic
    let value = result.unwrap();
    
    // unwrap_or: 获取值或返回默认值
    let value = result.unwrap_or(0);
    
    // unwrap_or_else: 获取值或执行闭包
    let value = result.unwrap_or_else(|_| 0);
    
    // expect: 带自定义panic消息的unwrap
    let value = result.expect("Expected a valid number");
    
    // is_ok / is_err: 检查结果
    if result.is_ok() {
        println!("Success!");
    }
    
    // map: 转换成功值
    let doubled = result.map(|x| x * 2);
    
    // map_err: 转换错误值
    let result = result.map_err(|e| format!("Error: {}", e));
}
```

## 错误传播

### Go的错误传播
```go
func level3() error {
    return errors.New("level 3 error")
}

func level2() error {
    if err := level3(); err != nil {
        return fmt.Errorf("level 2: %w", err)
    }
    return nil
}

func level1() error {
    if err := level2(); err != nil {
        return fmt.Errorf("level 1: %w", err)
    }
    return nil
}
```

### Rust的?操作符
```rust
fn level3() -> Result<(), String> {
    Err(String::from("level 3 error"))
}

fn level2() -> Result<(), String> {
    level3()?;  // 自动传播错误
    Ok(())
}

fn level1() -> Result<(), String> {
    level2()?;  // 自动传播错误
    Ok(())
}

fn main() {
    match level1() {
        Ok(()) => println!("Success"),
        Err(e) => println!("Error: {}", e),
    }
}
```

## 自定义错误类型

### Go自定义错误
```go
type ValidationError struct {
    Field   string
    Message string
}

func (e ValidationError) Error() string {
    return fmt.Sprintf("validation error in field '%s': %s", e.Field, e.Message)
}

func validateAge(age int) error {
    if age < 0 {
        return ValidationError{
            Field:   "age",
            Message: "age cannot be negative",
        }
    }
    if age > 150 {
        return ValidationError{
            Field:   "age",
            Message: "age seems unrealistic",
        }
    }
    return nil
}
```

### Rust自定义错误
```rust
use std::fmt;

#[derive(Debug)]
enum ValidationError {
    NegativeAge,
    UnrealisticAge,
    EmptyName,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ValidationError::NegativeAge => write!(f, "Age cannot be negative"),
            ValidationError::UnrealisticAge => write!(f, "Age seems unrealistic"),
            ValidationError::EmptyName => write!(f, "Name cannot be empty"),
        }
    }
}

impl std::error::Error for ValidationError {}

fn validate_age(age: i32) -> Result<(), ValidationError> {
    if age < 0 {
        Err(ValidationError::NegativeAge)
    } else if age > 150 {
        Err(ValidationError::UnrealisticAge)
    } else {
        Ok(())
    }
}
```

### 使用thiserror简化错误定义
```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Parse error: {0}")]
    Parse(#[from] std::num::ParseIntError),
    
    #[error("Custom error: {message}")]
    Custom { message: String },
}
```

## 错误处理最佳实践

### Go最佳实践
```go
// 1. 尽早返回错误
func processData(data []byte) error {
    if len(data) == 0 {
        return errors.New("empty data")
    }
    
    // 处理数据...
    return nil
}

// 2. 添加上下文信息
func saveToFile(filename string, data []byte) error {
    err := ioutil.WriteFile(filename, data, 0644)
    if err != nil {
        return fmt.Errorf("failed to save to file %s: %w", filename, err)
    }
    return nil
}

// 3. 使用哨兵错误
var ErrInvalidInput = errors.New("invalid input")

func validate(input string) error {
    if input == "" {
        return ErrInvalidInput
    }
    return nil
}
```

### Rust最佳实践
```rust
use anyhow::{Context, Result};

// 1. 使用anyhow::Result作为返回类型
fn process_data(data: &[u8]) -> Result<()> {
    if data.is_empty() {
        anyhow::bail!("empty data");
    }
    
    // 处理数据...
    Ok(())
}

// 2. 使用context添加上下文信息
fn save_to_file(filename: &str, data: &[u8]) -> Result<()> {
    std::fs::write(filename, data)
        .with_context(|| format!("Failed to save to file {}", filename))?;
    Ok(())
}

// 3. 结合使用多种错误处理方法
fn complex_operation(input: &str) -> Result<i32> {
    let num = input
        .parse::<i32>()
        .context("Failed to parse input as number")?;
    
    if num < 0 {
        anyhow::bail!("Negative numbers not allowed");
    }
    
    Ok(num * 2)
}
```

## 实践示例

### 文件处理对比

#### Go版本
```go
package main

import (
    "fmt"
    "io/ioutil"
    "strconv"
    "strings"
)

func readAndSumNumbers(filename string) (int, error) {
    // 读取文件
    content, err := ioutil.ReadFile(filename)
    if err != nil {
        return 0, fmt.Errorf("failed to read file: %w", err)
    }
    
    // 分割行
    lines := strings.Split(string(content), "\n")
    sum := 0
    
    for i, line := range lines {
        if line == "" {
            continue
        }
        
        num, err := strconv.Atoi(strings.TrimSpace(line))
        if err != nil {
            return 0, fmt.Errorf("failed to parse number at line %d: %w", i+1, err)
        }
        
        sum += num
    }
    
    return sum, nil
}

func main() {
    result, err := readAndSumNumbers("numbers.txt")
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    fmt.Printf("Sum: %d\n", result)
}
```

#### Rust版本
```rust
use std::fs;
use anyhow::{Context, Result};

fn read_and_sum_numbers(filename: &str) -> Result<i32> {
    // 读取文件
    let content = fs::read_to_string(filename)
        .with_context(|| format!("Failed to read file {}", filename))?;
    
    // 处理每一行
    let sum = content
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .try_fold(0, |acc, (i, line)| {
            line.trim()
                .parse::<i32>()
                .with_context(|| format!("Failed to parse number at line {}", i + 1))
                .map(|num| acc + num)
        })?;
    
    Ok(sum)
}

fn main() {
    match read_and_sum_numbers("numbers.txt") {
        Ok(sum) => println!("Sum: {}", sum),
        Err(e) => println!("Error: {}", e),
    }
}
```

## 练习

### 练习1：基础错误处理
实现一个计算器函数，支持加减乘除四种操作，正确处理所有可能的错误情况。

### 练习2：自定义错误类型
创建一个用户注册系统，定义自定义错误类型来处理不同的验证错误。

### 练习3：错误传播
实现一个配置文件读取器，能够从文件中读取JSON配置并解析，正确传播所有可能的错误。

## 关键要点

1. **Go使用多返回值处理错误，简单直接**
2. **Rust使用Result类型，提供编译时错误处理保证**
3. **?操作符让Rust的错误传播变得简洁**
4. **两种语言都强调显式错误处理**
5. **选择合适的错误处理库可以提高开发效率**

## 🔗 下一章

继续学习 [第4章：并发模型：Goroutines vs Async/Await](../04-concurrency/README.md)