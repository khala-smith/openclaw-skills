#!/usr/bin/env node
/**
 * scrape-article.js — 使用 agent-browser 抓取单篇文章内容
 *
 * 用法: node scrape-article.js <url>
 * 输出: 文章的纯文本内容
 */

import { execSync } from 'child_process';

const url = process.argv[2];

if (!url) {
    console.error('用法: node scrape-article.js <url>');
    process.exit(1);
}

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        console.error(`命令执行失败: ${cmd}`);
        return null;
    }
}

async function main() {
    // 1. 打开文章页面
    console.error(`[INFO] 正在打开 ${url}...`);
    run(`agent-browser open "${url}"`);

    // 2. 等待页面加载
    run('agent-browser wait 2000');

    // 3. 提取文章主体内容
    const extractJs = `
        (function() {
            // 尝试常见的文章内容选择器
            const selectors = [
                'article',
                '[class*="content"]',
                '[class*="article"]',
                '[class*="post"]',
                'main',
                '.prose',
                '#content'
            ];

            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.length > 200) {
                    return el.textContent.trim().replace(/\\s+/g, ' ').substring(0, 5000);
                }
            }

            // 回退到 body
            return document.body.textContent.trim().replace(/\\s+/g, ' ').substring(0, 5000);
        })()
    `;

    const content = run(`agent-browser eval '${extractJs.replace(/'/g, "\\'")}'`);

    if (content) {
        // 清理 JSON 转义
        try {
            const parsed = JSON.parse(content);
            console.log(parsed);
        } catch {
            console.log(content);
        }
    } else {
        // 备用：使用 snapshot
        console.error('[INFO] 使用 snapshot 获取内容...');
        const snapshot = run('agent-browser snapshot -c');
        console.log(snapshot || '');
    }
}

main().catch(err => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
