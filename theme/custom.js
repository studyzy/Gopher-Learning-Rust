// 自定义 JavaScript - Go程序员Rust学习指南

document.addEventListener('DOMContentLoaded', function() {
    // 添加代码复制功能
    addCodeCopyButtons();
    
    // 添加阅读进度条
    addReadingProgress();
    
    // 优化代码块显示
    enhanceCodeBlocks();
    
    // 添加返回顶部按钮
    addBackToTopButton();
    
    // 添加特殊标注框
    addSpecialBoxes();
});

// 为代码块添加复制按钮
function addCodeCopyButtons() {
    const codeBlocks = document.querySelectorAll('pre code');
    
    codeBlocks.forEach(function(codeBlock) {
        const pre = codeBlock.parentNode;
        const button = document.createElement('button');
        button.className = 'copy-button';
        button.textContent = '复制';
        button.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: #3498db;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        pre.style.position = 'relative';
        pre.appendChild(button);
        
        // 鼠标悬停时显示复制按钮
        pre.addEventListener('mouseenter', function() {
            button.style.opacity = '1';
        });
        
        pre.addEventListener('mouseleave', function() {
            button.style.opacity = '0';
        });
        
        // 复制功能
        button.addEventListener('click', function() {
            const text = codeBlock.textContent;
            navigator.clipboard.writeText(text).then(function() {
                button.textContent = '已复制!';
                button.style.background = '#27ae60';
                setTimeout(function() {
                    button.textContent = '复制';
                    button.style.background = '#3498db';
                }, 2000);
            });
        });
    });
}

// 添加阅读进度条
function addReadingProgress() {
    const progressBar = document.createElement('div');
    progressBar.id = 'reading-progress';
    progressBar.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 0%;
        height: 3px;
        background: linear-gradient(90deg, #3498db, #ce422b);
        z-index: 9999;
        transition: width 0.3s ease;
    `;
    document.body.appendChild(progressBar);
    
    window.addEventListener('scroll', function() {
        const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
        const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (winScroll / height) * 100;
        progressBar.style.width = scrolled + '%';
    });
}

// 优化代码块显示
function enhanceCodeBlocks() {
    const codeBlocks = document.querySelectorAll('pre code');
    
    codeBlocks.forEach(function(codeBlock) {
        const pre = codeBlock.parentNode;
        const language = codeBlock.className.match(/language-(\w+)/);
        
        if (language) {
            const label = document.createElement('div');
            label.textContent = language[1].toUpperCase();
            label.style.cssText = `
                position: absolute;
                top: -1px;
                left: 15px;
                background: #2c3e50;
                color: white;
                padding: 2px 8px;
                font-size: 11px;
                border-radius: 0 0 4px 4px;
                font-weight: 600;
                text-transform: uppercase;
            `;
            pre.style.position = 'relative';
            pre.appendChild(label);
        }
    });
}

// 添加返回顶部按钮
function addBackToTopButton() {
    const backToTop = document.createElement('button');
    backToTop.innerHTML = '↑';
    backToTop.id = 'back-to-top';
    backToTop.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        background: #3498db;
        color: white;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        font-size: 20px;
        font-weight: bold;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    document.body.appendChild(backToTop);
    
    window.addEventListener('scroll', function() {
        if (window.pageYOffset > 300) {
            backToTop.style.opacity = '1';
            backToTop.style.visibility = 'visible';
        } else {
            backToTop.style.opacity = '0';
            backToTop.style.visibility = 'hidden';
        }
    });
    
    backToTop.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    
    backToTop.addEventListener('mouseenter', function() {
        this.style.background = '#ce422b';
        this.style.transform = 'scale(1.1)';
    });
    
    backToTop.addEventListener('mouseleave', function() {
        this.style.background = '#3498db';
        this.style.transform = 'scale(1)';
    });
}

// 添加特殊标注框
function addSpecialBoxes() {
    const content = document.querySelector('.content');
    if (!content) return;
    
    // 查找特殊标记并转换为样式框
    const paragraphs = content.querySelectorAll('p');
    
    paragraphs.forEach(function(p) {
        const text = p.textContent.trim();
        
        if (text.startsWith('💡 ') || text.startsWith('提示：') || text.startsWith('Info:')) {
            p.className = 'info-box';
        } else if (text.startsWith('⚠️ ') || text.startsWith('警告：') || text.startsWith('Warning:')) {
            p.className = 'warning-box';
        } else if (text.startsWith('✅ ') || text.startsWith('成功：') || text.startsWith('Success:')) {
            p.className = 'success-box';
        }
    });
}

// 添加键盘快捷键支持
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + K 聚焦搜索框
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('searchbar');
        if (searchInput) {
            searchInput.focus();
        }
    }
    
    // ESC 键清除搜索
    if (e.key === 'Escape') {
        const searchInput = document.getElementById('searchbar');
        if (searchInput && document.activeElement === searchInput) {
            searchInput.value = '';
            searchInput.blur();
        }
    }
});

// 添加平滑滚动到锚点
document.addEventListener('click', function(e) {
    if (e.target.tagName === 'A' && e.target.getAttribute('href').startsWith('#')) {
        e.preventDefault();
        const targetId = e.target.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
});

// 添加打字机效果（可选，用于首页标题）
function typewriterEffect(element, text, speed = 100) {
    let i = 0;
    element.innerHTML = '';
    
    function type() {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// 页面加载完成后的初始化
window.addEventListener('load', function() {
    // 添加加载完成的淡入效果
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    
    setTimeout(function() {
        document.body.style.opacity = '1';
    }, 100);
});