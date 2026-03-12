#!/usr/bin/env node
/**
 * save-digest.js — 将 AI 新闻摘要保存到飞书
 *
 * 用法: node save-digest.js <digestJsonPath> [folderToken]
 *
 * digestJsonPath: JSON 文件路径，格式:
 * {
 *   "date": "2026-03-12",
 *   "articles": [
 *     { "title": "...", "source": "...", "summary": "...", "link": "..." },
 *     ...
 *   ]
 * }
 *
 * 输出: { doc_id, doc_url }
 */

import { readFileSync } from 'fs';
import { createFeishuDoc } from '../../shared/lib/feishu.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

const digestPath = process.argv[2];
const folderToken = process.argv[3];

if (!digestPath) {
    logError('用法: node save-digest.js <digestJsonPath> [folderToken]');
    process.exit(1);
}

// 生成 Lark-flavored Markdown
function generateMarkdown(digest) {
    const { date, articles } = digest;
    const lines = [];

    lines.push(`# AI 热点新闻 ${date}`);
    lines.push('');
    lines.push(`> 本文档由 Simone 自动整理，共收录 ${articles.length} 篇热点新闻。`);
    lines.push('');

    for (let i = 0; i < articles.length; i++) {
        const art = articles[i];
        lines.push(`## ${i + 1}. ${art.title}`);
        lines.push('');
        lines.push(`**来源**: ${art.source || '未知'}`);
        if (art.link) {
            lines.push(`**原文**: [链接](${art.link})`);
        }
        lines.push('');
        lines.push('### 摘要');
        lines.push('');
        lines.push(art.summary || '暂无摘要');
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}

async function main() {
    // 读取摘要 JSON
    let digest;
    try {
        digest = JSON.parse(readFileSync(digestPath, 'utf8'));
    } catch (e) {
        logError(`无法读取或解析 JSON: ${digestPath} — ${e.message}`);
        process.exit(1);
    }

    const date = digest.date || new Date().toISOString().split('T')[0];
    const title = `AI 热点新闻 ${date}`;
    const markdown = generateMarkdown(digest);

    // 创建飞书文档
    const options = {};
    if (folderToken) {
        options.folderToken = folderToken;
    }

    const result = await createFeishuDoc(title, markdown, options);
    console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
    logError('save-digest 执行异常', err.message);
    process.exit(1);
});
