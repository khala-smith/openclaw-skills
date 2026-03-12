#!/usr/bin/env node
/**
 * scrape-news.js — 使用 agent-browser 抓取 aihot.today/ai-news 新闻列表
 *
 * 用法: node scrape-news.js [--limit N]
 * 输出: JSON 数组 [{ title, source, time, ref }, ...]
 */

import { execSync } from 'child_process';

const URL = 'https://aihot.today/ai-news';
const limit = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '20');

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        console.error(`命令执行失败: ${cmd}`);
        console.error(e.message);
        return null;
    }
}

async function main() {
    // 1. 打开页面
    console.error('[INFO] 正在打开 aihot.today/ai-news...');
    run(`agent-browser open "${URL}"`);

    // 2. 等待页面加载
    console.error('[INFO] 等待页面加载...');
    run('agent-browser wait 3000');

    // 3. 获取页面快照
    console.error('[INFO] 获取页面快照...');
    const snapshot = run('agent-browser snapshot --json');

    if (!snapshot) {
        console.error('[ERROR] 无法获取页面快照');
        process.exit(1);
    }

    // 4. 解析快照，提取新闻条目
    // agent-browser snapshot 返回的是 accessibility tree
    // 我们需要找到 article 元素并提取信息
    let data;
    try {
        data = JSON.parse(snapshot);
    } catch {
        // 如果不是 JSON，可能是纯文本格式
        console.error('[INFO] 快照为纯文本格式，尝试解析...');

        // 使用 eval 获取页面上的新闻数据
        const articlesJs = `
            Array.from(document.querySelectorAll('article')).slice(0, ${limit}).map((el, idx) => {
                const title = el.querySelector('h3')?.textContent?.trim() || '';
                const sourceImg = el.querySelector('img[alt]');
                const source = sourceImg?.alt || '';
                const timeSpan = el.querySelector('span.text-gray-500');
                const time = timeSpan?.textContent?.trim() || '';
                return { title, source, time, index: idx };
            })
        `;

        const result = run(`agent-browser eval '${articlesJs.replace(/'/g, "\\'")}'`);
        if (result) {
            try {
                const articles = JSON.parse(result);
                console.log(JSON.stringify(articles, null, 2));
                return;
            } catch {
                console.error('[WARN] 无法解析 eval 结果');
            }
        }

        // 备用方案：直接输出快照让 agent 解析
        console.log(snapshot);
        return;
    }

    // 如果是 JSON 格式，直接输出
    console.log(JSON.stringify(data, null, 2));
}

main().catch(err => {
    console.error('[ERROR]', err.message);
    process.exit(1);
});
