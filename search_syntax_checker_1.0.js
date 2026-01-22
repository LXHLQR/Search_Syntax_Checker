// ==UserScript==
// @name         文献检索式语法检查
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动检查 jour.blyun.com 检索式语法的正确性，提供自动补全及错误提示功能
// @author       LXHLQR
// @match        *://jour.blyun.com/*
// @match        *://fjour.blyun.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 配置项
    const TARGET_ID = 'expertsw';

    // 允许的符号白名单 (除了字母数字汉字空格)
    // 规则2要求：出现除 () " ' * | - > = < 以外的符号应使用黄色提示框
    const ALLOWED_SYMBOLS_REGEX = /[a-zA-Z0-9\s\u4e00-\u9fa5\(\)"'\*\|\-\>\=\<]/;

    // 只能存在于 ) 和 ( 之间的符号
    const OPERATORS = ['*', '|', '-'];

    // 定义样式
    const STYLES = `
        .syntax-checker-box {
            box-sizing: border-box;
            width: 100%;
            padding: 8px 12px;
            margin-top: 5px;
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

    // 状态记录，用于规则4 (回删逻辑)
    let lastAutoComplete = {
        active: false,
        index: -1,
        char: ''
    };

    // 主初始化函数
    function init() {
        const textarea = document.getElementById(TARGET_ID);
        if (!textarea) return; // 元素未找到

        // 创建提示框容器
        const container = document.createElement('div');
        container.id = 'syntax-checker-container';
        // 插入到 textarea 后面
        textarea.parentNode.insertBefore(container, textarea.nextSibling);

        // 初始化显示绿色
        updateStatus(container, []);

        // 绑定事件
        textarea.addEventListener('input', () => validate(textarea, container));
        textarea.addEventListener('keyup', () => validate(textarea, container));
        textarea.addEventListener('keydown', (e) => handleKeyDown(e, textarea, container));
    }

    // --- 核心逻辑: 验证 (Rule 1, 2, 3, 5) ---
    function validate(textarea, container) {
        const text = textarea.value;
        const errors = []; // 存储所有错误对象 {type: 'red'|'yellow', msg: ''}

        // --- 规则 2: 符号检查 ---

        // 2.1 全角符号检查 (红色)
        const fullWidthPattern = /[^\x00-\xff]/g; // 匹配双字节字符
        // 排除汉字范围，只抓取全角标点
        // 简单方法：遍历字符判断
        let fullWidthCount = 0;
        const fullWidthChars = [];
        for (let char of text) {
            // 如果不是汉字且是全角符号 (粗略判断: code > 255 且不是汉字)
            // 更精准：针对检索式常见的全角符号
            if (char.match(/[！-～]/) || char === '（' || char === '）' || char === '”' || char === '“' || char === '’' || char === '‘') {
                fullWidthCount++;
                if (!fullWidthChars.includes(char)) fullWidthChars.push(char);
            }
        }
        if (fullWidthCount > 0) {
            errors.push({
                type: 'red',
                msg: `发现全角符号 ${fullWidthCount} 个 (${fullWidthChars.join(' ')})，请改为半角。`
            });
        }

        // 2.2 符号白名单 (黄色)
        // 出现除 () " ' * | - > = < 以外的符号 (且非字母数字汉字空格)
        let invalidSymbolCount = 0;
        let invalidSymbols = [];
        for (let char of text) {
            if (!ALLOWED_SYMBOLS_REGEX.test(char)) {
                invalidSymbolCount++;
                if (!invalidSymbols.includes(char)) invalidSymbols.push(char);
            }
        }
        if (invalidSymbolCount > 0) {
            errors.push({
                type: 'yellow',
                msg: `发现非预设符号 ${invalidSymbolCount} 个: ${invalidSymbols.join(' ')}`
            });
        }

        // 2.3 符号成对与完整性检查 (红色)
        // 括号 ()
        const leftParen = (text.match(/\(/g) || []).length;
        const rightParen = (text.match(/\)/g) || []).length;
        if (leftParen !== rightParen) {
            const diff = Math.abs(leftParen - rightParen);
            const missingType = leftParen > rightParen ? '右括号 )' : '左括号 (';
            errors.push({ type: 'red', msg: `缺少 ${missingType} ${diff} 个。` });
        }

        // 双引号 "
        const quoteCount = (text.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            errors.push({ type: 'red', msg: `缺少 双引号 " 1 个 (总数为奇数)。` });
        }

        // 单引号 '
        const singleQuoteCount = (text.match(/'/g) || []).length;
        if (singleQuoteCount % 2 !== 0) {
            errors.push({ type: 'red', msg: `缺少 单引号 ' 1 个 (总数为奇数)。` });
        }

        // 结尾检查
        if (text.length > 0) {
            const lastChar = text.trim().slice(-2);
            if (['(', '"', "'"].includes(lastChar)) {
                 errors.push({ type: 'red', msg: `检索式不应以 ${lastChar} 结尾。` });
            }
        }

        // --- 规则 3: * | - 逻辑检查 ---

        // 3.1 检查这三种符号是否仅存在于 ) 与 ( 之间 (黄色警告)
        // 也就是：如果出现了 *，它的左边(忽略空格)必须是 )，右边(忽略空格)必须是 (
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (OPERATORS.includes(char)) {
                // 向左寻找非空字符
                let leftOk = false;
                for (let j = i - 1; j >= 0; j--) {
                    if (text[j] === ')') { leftOk = true; break; }
                    if (text[j].trim() !== '') break; // 遇到其他字符
                }

                // 向右寻找非空字符
                let rightOk = false;
                for (let j = i + 1; j < text.length; j++) {
                    if (text[j] === '(') { rightOk = true; break; }
                    if (text[j].trim() !== '') break;
                }

                if (!leftOk || !rightOk) {
                    errors.push({
                        type: 'yellow',
                        msg: `符号 "${char}" 位置不正确。它只能出现在右括号 ) 与左括号 ( 之间。`
                    });
                    // 为避免重复报错同一个逻辑，这里可以 break 或者继续，看需求。这里暂且继续找出所有。
                }
            }
        }

        // 3.2 检查 ) 和 ( 之间是否仅存在 * | - (红色警告)
        // 思路：找到所有 ...)...(... 的结构，检查中间的内容
        // 使用正则全局匹配 ) 和 (，然后检查索引间的字符串
        const rightParenIndices = [];
        const leftParenIndices = [];
        for(let i=0; i<text.length; i++) {
            if(text[i] === ')') rightParenIndices.push(i);
            if(text[i] === '(') leftParenIndices.push(i);
        }

        // 对于每一个 )，查看它后面紧跟着的第一个 ( 是哪个
        // 这种逻辑对于嵌套括号比较复杂。规则原文："右括号与左括号之间"
        // 简化理解：只要文本中出现了 `) ... (` 的片段，中间的 `...` 必须符合要求。

        // 遍历整个字符串寻找 `)`
        let leftParenNumber = 0;
        //let rightParenNumber = 0;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '(') {
                leftParenNumber += 1;
            }
            if (leftParenNumber === leftParen) { break; }
            //if (leftParenNumber == 0) { break; }

            if (text[i] === ')') {
                // 从这里开始找下一个非空白字符
                let contentBuffer = "";
                let hasLeftParen = false;

                for (let j = i + 1; j < text.length; j++) {
                    const nextChar = text[j];
                    if (nextChar === '(') {
                        // hasLeftParen = true;
                        // // 检查 contentBuffer
                        // const trimmed = contentBuffer.trim(); // 忽略纯空格
                        if (contentBuffer !== '') {
                            // 检查 trimmed 是否只包含 * | -
                            // 且根据规则3，这三种符号是否仅存在于此。
                            // 此时我们只检查：这里面是不是混入了别的东西
                            const validContent = /^[*|-]$/.test(contentBuffer.replace(/\)/g, ''));
                            if (!validContent) {
                                let errorContent = contentBuffer.replace(/\)/g, '');
                                errors.push({
                                    type: 'red',
                                    msg: `右括号 ) 与左括号 ( 之间出现了非法内容 ${errorContent} (仅允许单个 * | - )。`
                                });
                            }
                        } else {
                             // 如果中间全是空格或空的，也属于 "不存在这三种符号"，按规则需黄色提醒？
                             // 规则原文："如果不存在或则用黄色提示框提醒" -> 指的是 ) 和 ( 之间没有 *|- 吗？
                             // 是的，"缺少符号"。
                             errors.push({
                                type: 'yellow',
                                msg: `右括号 ) 与左括号 ( 之间缺少逻辑符号 (* | -)。`
                            });
                        }
                        break; // 这一对检查完毕
                    } else {
                        contentBuffer += nextChar;
                        // 如果遇到并非 * | - 且非空格的内容，其实已经可以预判错误，但为了找到 ( 确认是 )-( 结构，继续循环
                    }
                }
            }
        }

        // 去重错误信息 (可选)
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

    // --- UI 更新逻辑 (Rule 1, 5) ---
    function updateStatus(container, errors) {
        container.innerHTML = ''; // 清空

        if (errors.length === 0) {
            // 绿色状态
            const div = document.createElement('div');
            div.className = 'syntax-checker-box syntax-status-green';
            div.textContent = '输入内容未出现问题';
            container.appendChild(div);
        } else {
            // 错误堆叠显示
            errors.forEach(err => {
                const div = document.createElement('div');
                div.className = `syntax-checker-box syntax-status-${err.type}`;
                div.textContent = err.msg;
                container.appendChild(div);
            });
        }
    }

    // --- 自动补全逻辑 (Rule 4) ---
    function handleKeyDown(e, textarea, container) {
        const key = e.key;
        const val = textarea.value;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        // 辅助：检查是否缺少另一半符号
        // 规则4要求：如果缺少另一半符号则该条规则不执行
        // 我们简单检查当前的总计数。
        const leftCount = (val.match(/\(/g) || []).length;
        const rightCount = (val.match(/\)/g) || []).length;
        const quoteCount = (val.match(/"/g) || []).length;
        const singleQuoteCount = (val.match(/'/g) || []).length;

        // 1. 回删逻辑 (Backspace)
        if (key === 'Backspace') {
            if (lastAutoComplete.active &&
                start === lastAutoComplete.index + 1 &&
                start === end) {
                // 判断当前光标前后的字符是否是刚才补全的那一对
                const charBefore = val.substring(start - 1, start);
                const charAfter = val.substring(start, start + 1);

                let pairMatch = false;
                if (lastAutoComplete.char === '(' && charBefore === '(' && charAfter === ')') pairMatch = true;
                if (lastAutoComplete.char === '"' && charBefore === '"' && charAfter === '"') pairMatch = true;
                if (lastAutoComplete.char === "'" && charBefore === "'" && charAfter === "'") pairMatch = true;

                if (pairMatch) {
                    e.preventDefault();
                    // 删除这一对
                    const newVal = val.substring(0, start - 1) + val.substring(start + 1);
                    textarea.value = newVal;
                    textarea.setSelectionRange(start - 1, start - 1);
                    // 触发 input 更新验证
                    validate(textarea, container);
                }
            }
            // 重置状态
            lastAutoComplete = { active: false, index: -1, char: '' };
            return;
        }

        // 2. 右侧符号跳过逻辑 (输入 ) " ' 时)
        if ((key === ')' || key === '"' || key === "'") && start === end) {
            const charAfter = val.substring(start, start + 1);
            if (charAfter === key) {
                // 如果当前光标右边就是我要输入的字符，且是由我之前补全的(或者存在的)，则跳过不输入，光标右移
                // 但需要区分引号：如果引号是奇数个，可能是在补全左边？
                // 规则4主要针对“自动补全后...输入对应的右侧符号”。
                // 简单处理：只要右边是该符号，就跳过。
                e.preventDefault();
                textarea.setSelectionRange(start + 1, start + 1);
                return;
            }
        }

        // 3. 左侧符号补全逻辑 ( ( " ' )
        const pairs = { '(': ')', '"': '"', "'": "'" };
        if (pairs.hasOwnProperty(key)) {
            // 检查是否允许补全：如果缺少另一半，则不执行
            let allow = true;
            if (key === '(' && leftCount > rightCount) allow = false; // 缺右括号，这次输入可能是为了补它，不自动加
            // 引号比较特殊，如果已经是奇数，说明当前正在输入右引号(逻辑上)，或者缺引号。
            // 规则说：缺少另一半则不执行。如果当前有 1 个 "，输入 "，变成了 2 个 (平衡)。
            // 如果 count 是奇数，通常意味着正在闭合，所以不补全。
            if (key === '"' && quoteCount % 2 !== 0) allow = false;
            if (key === "'" && singleQuoteCount % 2 !== 0) allow = false;

            if (allow) {
                e.preventDefault();
                const insertStr = key + pairs[key];
                const newVal = val.substring(0, start) + insertStr + val.substring(end);

                textarea.value = newVal;
                // 光标移到中间
                textarea.setSelectionRange(start + 1, start + 1);

                // 记录状态用于回删
                lastAutoComplete = {
                    active: true,
                    index: start,
                    char: key
                };

                // 触发验证
                validate(textarea, container);
            }
        } else {
            // 输入其他字符，重置回删状态
            lastAutoComplete = { active: false, index: -1, char: '' };
        }
    }

    // 使用 MutationObserver 防止页面动态加载导致找不到元素
    const observer = new MutationObserver((mutations) => {
        if (document.getElementById(TARGET_ID) && !document.getElementById('syntax-checker-container')) {
            init();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 尝试直接初始化
    init();

})();