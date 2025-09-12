// Rust版本的程序员示例
struct Programmer {
    name: String,
    language: String,
}

impl Programmer {
    fn new(name: String, language: String) -> Programmer {
        Programmer { name, language }
    }
    
    fn introduce(&self) -> String {
        format!("Hi, I'm {} and I love {}!", self.name, self.language)
    }
}

fn main() {
    let rustacean = Programmer::new(
        String::from("Alice"), 
        String::from("Rust")
    );
    println!("{}", rustacean.introduce());
}