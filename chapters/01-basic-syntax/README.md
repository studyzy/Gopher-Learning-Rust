# 第1章：Go vs Rust 基础语法对比

本章将通过对比的方式，帮助Go开发者快速理解Rust的基础语法。

## 📖 目录
- [变量声明](#变量声明)
- [数据类型](#数据类型)
- [函数定义](#函数定义)
- [控制流](#控制流)
- [结构体](#结构体)
- [方法定义](#方法定义)
- [练习](#练习)

## 变量声明

### Go
```go
// 声明并初始化
var name string = "Gopher"
var age int = 25

// 类型推导
var name = "Gopher"
age := 25

// 零值
var count int  // 0
var flag bool  // false
```

### Rust
```rust
// 不可变变量（默认）
let name: String = String::from("Rustacean");
let age: i32 = 25;

// 类型推导
let name = String::from("Rustacean");
let age = 25;

// 可变变量
let mut count = 0;
count += 1;

// 默认值需要显式初始化
let flag: bool = false;
```

**关键差异：**
- Rust变量默认不可变，需要`mut`关键字声明可变
- Rust没有零值概念，必须显式初始化
- Rust使用`let`关键字声明变量

## 数据类型

### 基础类型对比

| Go | Rust | 说明 |
|---|---|---|
| `int8` | `i8` | 8位有符号整数 |
| `int16` | `i16` | 16位有符号整数 |
| `int32` | `i32` | 32位有符号整数 |
| `int64` | `i64` | 64位有符号整数 |
| `uint8` | `u8` | 8位无符号整数 |
| `uint16` | `u16` | 16位无符号整数 |
| `uint32` | `u32` | 32位无符号整数 |
| `uint64` | `u64` | 64位无符号整数 |
| `float32` | `f32` | 32位浮点数 |
| `float64` | `f64` | 64位浮点数 |
| `bool` | `bool` | 布尔类型 |
| `string` | `String` / `&str` | 字符串类型 |

### 字符串处理

#### Go
```go
// 字符串字面量
str := "Hello, World!"

// 字符串拼接
greeting := "Hello, " + "World!"

// 字符串长度
length := len(str)

// 字符串切片
substr := str[0:5]
```

#### Rust
```rust
// 字符串字面量（&str）
let str = "Hello, World!";

// 可变字符串（String）
let mut greeting = String::from("Hello, ");
greeting.push_str("World!");

// 字符串长度
let length = str.len();

// 字符串切片
let substr = &str[0..5];
```

## 函数定义

### Go
```go
// 基础函数
func add(a int, b int) int {
    return a + b
}

// 多返回值
func divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// 可变参数
func sum(numbers ...int) int {
    total := 0
    for _, num := range numbers {
        total += num
    }
    return total
}
```

### Rust
```rust
// 基础函数
fn add(a: i32, b: i32) -> i32 {
    a + b  // 注意：没有return和分号
}

// 返回Result类型处理错误
fn divide(a: i32, b: i32) -> Result<i32, String> {
    if b == 0 {
        Err(String::from("division by zero"))
    } else {
        Ok(a / b)
    }
}

// 可变参数（使用切片）
fn sum(numbers: &[i32]) -> i32 {
    numbers.iter().sum()
}
```

**关键差异：**
- Rust函数返回值是表达式，不需要`return`关键字
- Rust使用`Result<T, E>`类型处理错误，而不是多返回值
- Rust参数类型必须显式声明

## 控制流

### 条件语句

#### Go
```go
if age >= 18 {
    fmt.Println("成年人")
} else if age >= 13 {
    fmt.Println("青少年")
} else {
    fmt.Println("儿童")
}

// 带初始化的if
if err := doSomething(); err != nil {
    return err
}
```

#### Rust
```rust
if age >= 18 {
    println!("成年人");
} else if age >= 13 {
    println!("青少年");
} else {
    println!("儿童");
}

// if是表达式，可以返回值
let category = if age >= 18 {
    "成年人"
} else if age >= 13 {
    "青少年"
} else {
    "儿童"
};
```

### 循环

#### Go
```go
// for循环
for i := 0; i < 10; i++ {
    fmt.Println(i)
}

// while循环（使用for）
for condition {
    // do something
}

// 遍历切片
numbers := []int{1, 2, 3, 4, 5}
for i, num := range numbers {
    fmt.Printf("Index: %d, Value: %d\n", i, num)
}
```

#### Rust
```rust
// for循环
for i in 0..10 {
    println!("{}", i);
}

// while循环
while condition {
    // do something
}

// 遍历数组
let numbers = [1, 2, 3, 4, 5];
for (i, num) in numbers.iter().enumerate() {
    println!("Index: {}, Value: {}", i, num);
}

// 无限循环
loop {
    // do something
    break;
}
```

### match vs switch

#### Go
```go
switch day {
case "Monday":
    fmt.Println("周一")
case "Tuesday":
    fmt.Println("周二")
default:
    fmt.Println("其他")
}
```

#### Rust
```rust
match day {
    "Monday" => println!("周一"),
    "Tuesday" => println!("周二"),
    _ => println!("其他"),
}

// match是表达式
let chinese_day = match day {
    "Monday" => "周一",
    "Tuesday" => "周二",
    _ => "其他",
};
```

## 结构体

### Go
```go
type Person struct {
    Name string
    Age  int
}

// 构造函数（约定）
func NewPerson(name string, age int) *Person {
    return &Person{
        Name: name,
        Age:  age,
    }
}
```

### Rust
```rust
struct Person {
    name: String,
    age: i32,
}

// 关联函数（构造函数）
impl Person {
    fn new(name: String, age: i32) -> Person {
        Person { name, age }
    }
}
```

## 方法定义

### Go
```go
func (p *Person) Greet() string {
    return fmt.Sprintf("Hello, I'm %s", p.Name)
}

func (p *Person) HaveBirthday() {
    p.Age++
}
```

### Rust
```rust
impl Person {
    fn greet(&self) -> String {
        format!("Hello, I'm {}", self.name)
    }
    
    fn have_birthday(&mut self) {
        self.age += 1;
    }
}
```

**关键差异：**
- Rust使用`impl`块定义方法
- `&self`对应Go的值接收者，`&mut self`对应指针接收者
- Rust的方法调用会自动解引用

## 练习

### 练习1：Hello World
创建一个程序，分别用Go和Rust实现：
1. 定义一个结构体`Programmer`，包含`name`和`language`字段
2. 实现一个方法`introduce()`，输出程序员的自我介绍
3. 创建实例并调用方法

### 练习2：计算器
实现一个简单的计算器：
1. 定义加、减、乘、除四个函数
2. 使用match/switch处理不同的操作
3. 正确处理除零错误

### 参考答案

查看 [examples](./examples/) 目录获取练习答案。

## 🔗 下一章

继续学习 [第2章：内存管理：垃圾回收 vs 所有权](../02-memory-management/README.md)