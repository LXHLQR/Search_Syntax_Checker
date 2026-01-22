// ==UserScript==
// @name         文献检索语法检测
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  自动检查 jour.blyun.com 检索式语法的正确性，提供自动补全及错误提示功能，支持高级逻辑扩展
// @author       LXHLQR
// @match        *://jour.blyun.com/*
// @match        *://fjour.blyun.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 配置项
    const TARGET_ID = 'expertsw';
    const targetUrl = "https://fjour.blyun.com/views/specific/3004/style/senior_search.css";
    const targetSelector = ".profes_form textarea";

    // 允许的符号白名单 (除了字母数字汉字空格)
    const ALLOWED_SYMBOLS_REGEX = /[a-zA-Z0-9\s\u4e00-\u9fa5\(\)"'\*\|\-\>\=\<]/;
    // 只能存在于 ) 和 ( 之间的符号
    const OPERATORS = ['*', '|', '-'];
    // 允许自动补全的字段列表
    const VALID_FIELDS = ['T', 'A', 'K', 'Y', 'O', 'JNj', 'S'];

    // 获取原有样式宽度 (保留原有逻辑)
    const checker_box_width = getCssWidth(targetUrl, targetSelector);

    // 定义样式
    const STYLES = `
        /* 新增：包裹容器，用于横向排列侧边栏和文本框 */
        #search-wrapper {
            display: flex;
            align-items: flex-start;
            margin-bottom: 10px;
        }

        /* 新增：左侧侧边栏样式 */
        .auto-complete-sidebar {
            width: 135px; /* 适当宽度 */
            height: 200px;
            background-color: #f6ffed; /* 绿色背景 */
            border: 1px solid #b7eb8f;
            color: #389e0d;
            padding: 15px;
            box-sizing: border-box;
            margin-right: 10px;
            border-radius: 4px;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        /* 新增：自动补全搜索标题字体样式 */
        .auto-complete-sidebar h3 {
            margin: 0;
            font-size: 14px;
            font-weight: bold;
            color: #237804;
            border-bottom: 1px solid #b7eb8f;
            padding-bottom: 5px;
        }

        /* 新增：自动补全输入字体样式 */
        .auto-complete-sidebar input {
            padding: 5px;
            border: 1px solid #b7eb8f;
            border-radius: 3px;
            width: 100%;
            box-sizing: border-box;
            color: #237804;
            font-weight: bold;
            text-align: center;
        }

        .syntax-checker-box {
            box-sizing: border-box;
            width: 100%
            padding: 8px 12px;
            margin: 5px auto;
            font-size: 13px;
            line-height: 1.5;
            border-radius: 4px;
            font-family: sans-serif;
            white-space: pre-wrap;
        }
        .syntax-status-green {
            background-color: #f6ffed;
            border: 1px solid #b7eb8f;
            color: #389e0d;
        }
        .syntax-status-red {
            background-color: #fff1f0;
            border: 1px solid #ffa39e;
            color: #cf1322;
            margin-bottom: 4px;
        }
        .syntax-status-yellow {
            background-color: #fffbe6;
            border: 1px solid #ffe58f;
            color: #d48806;
            margin-bottom: 4px;
        }
    `;

    // 注入样式
    const styleSheet = document.createElement("style");
    styleSheet.innerText = STYLES;
    document.head.appendChild(styleSheet);

    let lastAutoComplete = { active: false, index: -1, char: '' };

    // 主初始化函数
    function init() {
        const textarea = document.getElementById(TARGET_ID);
        if (!textarea) return;

        // 防止重复初始化
        if (document.getElementById('syntax-checker-container')) return;

        // 1. 创建包裹容器 (Flex)
        const wrapper = document.createElement('div');
        wrapper.id = 'search-wrapper';

        // 2. 创建左侧侧边栏
        const sidebar = document.createElement('div');
        sidebar.className = 'auto-complete-sidebar';
        sidebar.innerHTML = `
            <h3>自动补全内容</h3>
            <div>
                <div>补全类型为：</div>
                <div style="font-size:12px; color: #555; margin-bottom:4px;">
                (T A K Y O S JNj)<br>
                输入 ((T="XXX 后再次输入 " 即可进行补全
            </div>
            <input type="text" id="target-field-input" value="K" maxlength="3">
        `;

        // 3. 调整 DOM 结构
        const parent = textarea.parentNode;
        parent.insertBefore(wrapper, textarea);
        wrapper.appendChild(sidebar);
        wrapper.appendChild(textarea);

        // 4. 创建提示框容器
        const container = document.createElement('div');
        container.id = 'syntax-checker-container';
        parent.insertBefore(container, wrapper.nextSibling);

        // 初始化显示绿色
        updateStatus(container, []);

        // 绑定事件
        textarea.addEventListener('input', () => validate(textarea, container));
        textarea.addEventListener('keyup', () => validate(textarea, container));
        textarea.addEventListener('keydown', (e) => handleKeyDown(e, textarea, container));
    }

    // --- 核心逻辑: 验证 (保持原逻辑不变) ---
    function validate(textarea, container) {
        const text = textarea.value;
        const errors = [];

        // 2.1 全角符号检查
        let fullWidthCount = 0;
        const fullWidthChars = [];
        for (let char of text) {
            if (char.match(/[！-～]/) || ['（','）','”','“','’','‘'].includes(char)) {
                fullWidthCount++;
                if (!fullWidthChars.includes(char)) fullWidthChars.push(char);
            }
        }
        if (fullWidthCount > 0) {
            errors.push({ type: 'red', msg: `发现全角符号 ${fullWidthCount} 个 (${fullWidthChars.join(' ')})，请改为半角。` });
        }

        // 2.2 符号白名单
        let invalidSymbolCount = 0;
        let invalidSymbols = [];
        for (let char of text) {
            if (!ALLOWED_SYMBOLS_REGEX.test(char)) {
                invalidSymbolCount++;
                if (!invalidSymbols.includes(char)) invalidSymbols.push(char);
            }
        }
        if (invalidSymbolCount > 0) {
            errors.push({ type: 'yellow', msg: `发现非预设符号 ${invalidSymbolCount} 个: ${invalidSymbols.join(' ')}` });
        }

        // 2.3 符号成对与完整性
        const leftParen = (text.match(/\(/g) || []).length;
        const rightParen = (text.match(/\)/g) || []).length;
        if (leftParen !== rightParen) {
            const diff = Math.abs(leftParen - rightParen);
            const missingType = leftParen > rightParen ? '右括号 )' : '左括号 (';
            errors.push({ type: 'red', msg: `缺少 ${missingType} ${diff} 个。` });
        }
        if ((text.match(/"/g) || []).length % 2 !== 0) errors.push({ type: 'red', msg: `缺少 双引号 " 1 个 (总数为奇数)。` });
        if ((text.match(/'/g) || []).length % 2 !== 0) errors.push({ type: 'red', msg: `缺少 单引号 ' 1 个 (总数为奇数)。` });

        if (text.length > 0) {
            const lastChar = text.trim().slice(-2);
            if (['(', '"', "'"].includes(lastChar)) errors.push({ type: 'red', msg: `检索式不应以 ${lastChar} 结尾。` });
        }

        // 3.1 & 3.2 逻辑符号检查
        for (let i = 0; i < text.length; i++) {
            if (OPERATORS.includes(text[i])) {
                let leftOk = false, rightOk = false;
                for (let j = i - 1; j >= 0; j--) {
                    if (text[j] === ')') { leftOk = true; break; }
                    if (text[j].trim() !== '') break;
                }
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '(') { rightOk = true; break; }
                    if (text[j].trim() !== '') break;
                }
                if (!leftOk || !rightOk) {
                    errors.push({ type: 'yellow', msg: `符号 "${text[i]}" 位置不正确。它只能出现在右括号 ) 与左括号 ( 之间。` });
                }
            }
        }

        let leftParenNumber = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '(') leftParenNumber++;
            if (leftParenNumber === leftParen) break;
            if (text[i] === ')') {
                let contentBuffer = "";
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '(') {
                        if (contentBuffer !== '') {
                            if (!/^[*|-]$/.test(contentBuffer.replace(/\)/g, ''))) {
                                errors.push({ type: 'red', msg: `右括号 ) 与左括号 ( 之间出现了非法内容 (仅允许单个 * | - )。` });
                            }
                        } else {
                             errors.push({ type: 'yellow', msg: `右括号 ) 与左括号 ( 之间缺少逻辑符号 (* | -)。` });
                        }
                        break;
                    } else {
                        contentBuffer += text[j];
                    }
                }
            }
        }

        // 去重
        const uniqueErrors = [];
        const msgSet = new Set();
        errors.forEach(e => {
            const key = e.type + e.msg;
            if(!msgSet.has(key)){
                msgSet.add(key);
                uniqueErrors.push(e);
            }
        });

        updateStatus(container, uniqueErrors);
    }

    // --- UI 更新 ---
    function updateStatus(container, errors) {
        container.innerHTML = '';
        if (errors.length === 0) {
            const div = document.createElement('div');
            div.className = 'syntax-checker-box syntax-status-green';
            div.textContent = '输入内容未出现问题';
            container.appendChild(div);
        } else {
            errors.forEach(err => {
                const div = document.createElement('div');
                div.className = `syntax-checker-box syntax-status-${err.type}`;
                div.textContent = err.msg;
                container.appendChild(div);
            });
        }
    }

    // --- 键盘交互与自动补全 ---
    function handleKeyDown(e, textarea, container) {
        const key = e.key;
        const val = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        // 辅助计数
        const leftCount = (val.match(/\(/g) || []).length;
        const rightCount = (val.match(/\)/g) || []).length;
        const quoteCount = (val.match(/"/g) || []).length;
        const singleQuoteCount = (val.match(/'/g) || []).length;

        // 1. 回删逻辑
        if (key === 'Backspace') {
            if (lastAutoComplete.active && start === lastAutoComplete.index + 1 && start === end) {
                const charBefore = val.substring(start - 1, start);
                const charAfter = val.substring(start, start + 1);
                let pairMatch = false;
                if (lastAutoComplete.char === '(' && charBefore === '(' && charAfter === ')') pairMatch = true;
                if (lastAutoComplete.char === '"' && charBefore === '"' && charAfter === '"') pairMatch = true;
                if (lastAutoComplete.char === "'" && charBefore === "'" && charAfter === "'") pairMatch = true;

                if (pairMatch) {
                    e.preventDefault();
                    textarea.value = val.substring(0, start - 1) + val.substring(start + 1);
                    textarea.setSelectionRange(start - 1, start - 1);
                    validate(textarea, container);
                }
            }
            lastAutoComplete = { active: false, index: -1, char: '' };
            return;
        }

        // 2. 右侧符号跳过逻辑 (包含高级补全)
        if ((key === ')' || key === '"' || key === "'") && start === end) {
            const charAfter = val.substring(start, start + 1);
            if (charAfter === key) {
                // 如果是双引号，且光标右侧也是双引号，这里可能触发“高级补全”
                if (key === '"') {
                    // 获取光标前的文本
                    const textBefore = val.substring(0, start);
                    
                    // --- 修改点：正则匹配改为单括号起始 ---
                    // 匹配 (字段="内容
                    const pattern = /\((T|A|K|Y|O|JNj|S)="([^"]+)$/;
                    const match = textBefore.match(pattern);

                    if (match) {
                        e.preventDefault(); 
                        const sourceField = match[1]; // 例如 T
                        const searchContent = match[2]; // 例如 test
                        
                        // 获取侧边栏的目标字段
                        const targetInput = document.getElementById('target-field-input');
                        let targetField = targetInput ? targetInput.value.trim().toUpperCase() : 'K';
                        
                        // JNj 特殊处理
                        if (targetInput && targetInput.value === 'JNj') {
                            targetField = 'JNj';
                        } else if (!VALID_FIELDS.includes(targetField)) {
                            targetField = 'K';
                        }

                        // --- 修改点：补全逻辑去掉了最外层包裹的括号 ---
                        // 构建新字符串： (T="test")|(K="test")
                        // 这里 match[0] 是 (T="test"，我们将其替换掉

                        // 1. 删除光标右侧自动补全的一个引号和一个括号
                        const textAfterQuote = val.substring(start + 2); 
                        
                        const replacement = `(${sourceField}="${searchContent}")|(${targetField}="${searchContent}")`;
                        const newTextBefore = textBefore.replace(pattern, replacement);
                        
                        textarea.value = newTextBefore + textAfterQuote;
                        
                        const newCursorPos = newTextBefore.length;
                        textarea.setSelectionRange(newCursorPos, newCursorPos);
                        
                        validate(textarea, container);
                        return; // 结束处理
                    }
                }

                // 正常的跳过逻辑
                e.preventDefault();
                textarea.setSelectionRange(start + 1, start + 1);
                return;
            }
        }

        // 3. 左侧符号补全逻辑
        const pairs = { '(': ')', '"': '"', "'": "'" };
        if (pairs.hasOwnProperty(key)) {
            let allow = true;
            if (key === '(' && leftCount > rightCount) allow = false;
            
            if (start !== end) {
                // 选区包裹
                e.preventDefault();
                const selectedText = val.substring(start, end);
                const insertStr = key + selectedText + pairs[key];
                textarea.value = val.substring(0, start) + insertStr + val.substring(end);
                textarea.setSelectionRange(start + 1, start + 1 + selectedText.length);
                lastAutoComplete = { active: false, index: -1, char: '' };
                validate(textarea, container);
            } else if (allow) {
                // 直接插入
                if (key === '"' && quoteCount % 2 !== 0) allow = false;
                if (key === "'" && singleQuoteCount % 2 !== 0) allow = false;
                
                if (allow) {
                    e.preventDefault();
                    const insertStr = key + pairs[key];
                    textarea.value = val.substring(0, start) + insertStr + val.substring(end);
                    textarea.setSelectionRange(start + 1, start + 1);
                    lastAutoComplete = { active: true, index: start, char: key };
                    validate(textarea, container);
                }
            }
        } else {
            lastAutoComplete = { active: false, index: -1, char: '' };
        }
    }

    // 辅助：获取 CSS 宽度
    function getCssWidth(url, selector) {
        for (let i = 0; i < document.styleSheets.length; i++) {
            const sheet = document.styleSheets[i];
            if (sheet.href && sheet.href === url) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    for (let j = 0; j < rules.length; j++) {
                        if (rules[j].selectorText && rules[j].selectorText.includes(selector)) {
                            return rules[j].style.width;
                        }
                    }
                } catch (e) {
                }
            }
        }
        return null;
    }

    // 使用 MutationObserver 防止页面动态加载导致找不到元素
    const observer = new MutationObserver((mutations) => {
        if (document.getElementById(TARGET_ID) && !document.getElementById('search-wrapper')) {
            init();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    init();

})();