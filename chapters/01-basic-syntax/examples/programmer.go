// Go版本的程序员示例
package main

import "fmt"

type Programmer struct {
	Name     string
	Language string
}

func NewProgrammer(name, language string) *Programmer {
	return &Programmer{
		Name:     name,
		Language: language,
	}
}

func (p *Programmer) Introduce() string {
	return fmt.Sprintf("Hi, I'm %s and I love %s!", p.Name, p.Language)
}

func main() {
	gopher := NewProgrammer("Alice", "Go")
	fmt.Println(gopher.Introduce())
}