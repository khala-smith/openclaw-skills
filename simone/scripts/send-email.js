#!/usr/bin/env node
/**
 * send-email.js — 通过 agentmail 发送 HTML 格式的 AI 新闻摘要邮件
 *
 * 用法: node send-email.js <digestJsonPath> <recipients>
 *
 * recipients: 逗号分隔的邮箱列表，如 "a@example.com,b@example.com"
 *
 * 环境变量: AGENTMAIL_API_KEY
 */

import { readFileSync } from 'fs';
import { logInfo, logError } from '../../shared/lib/logger.js';

const AGENTMAIL_API = 'https://api.agentmail.to/v0';

const digestPath = process.argv[2];
const recipients = process.argv[3];

if (!digestPath || !recipients) {
    logError('用法: node send-email.js <digestJsonPath> <recipients>');
    logError('  recipients: 逗号分隔的邮箱列表');
    process.exit(1);
}

const apiKey = process.env.AGENTMAIL_API_KEY;
if (!apiKey) {
    logError('未设置 AGENTMAIL_API_KEY 环境变量');
    process.exit(1);
}

// 生成美观的 HTML 邮件
function generateHtmlEmail(digest) {
    const { date, articles } = digest;

    const articleHtml = articles.map((art, i) => `
        <div style="background: #ffffff; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-size: 14px; font-weight: 600; padding: 4px 12px; border-radius: 20px;">${i + 1}</span>
                <span style="margin-left: 12px; color: #6b7280; font-size: 13px;">${art.source || '来源未知'}</span>
            </div>
            <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #1f2937; line-height: 1.4;">
                ${art.link ? `<a href="${art.link}" style="color: #1f2937; text-decoration: none;">${art.title}</a>` : art.title}
            </h2>
            <p style="margin: 0; color: #4b5563; font-size: 15px; line-height: 1.7;">${art.summary || '暂无摘要'}</p>
            ${art.link ? `<a href="${art.link}" style="display: inline-block; margin-top: 12px; color: #667eea; font-size: 14px; text-decoration: none;">阅读原文 →</a>` : ''}
        </div>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 热点新闻 ${date}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f3f4f6;">
    <div style="max-width: 640px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="margin: 0 0 8px 0; font-size: 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                🤖 AI 热点新闻
            </h1>
            <p style="margin: 0; color: #6b7280; font-size: 15px;">${date} · 共 ${articles.length} 条</p>
        </div>

        <!-- Articles -->
        ${articleHtml}

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; color: #9ca3af; font-size: 13px;">
                由 Simone 自动整理 · 数据来源 <a href="https://aihot.today" style="color: #667eea; text-decoration: none;">aihot.today</a>
            </p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

// 生成纯文本版本
function generateTextEmail(digest) {
    const { date, articles } = digest;
    const lines = [`AI 热点新闻 ${date}`, `共 ${articles.length} 条`, '', '---', ''];

    articles.forEach((art, i) => {
        lines.push(`${i + 1}. ${art.title}`);
        lines.push(`   来源: ${art.source || '未知'}`);
        lines.push(`   ${art.summary || '暂无摘要'}`);
        if (art.link) lines.push(`   原文: ${art.link}`);
        lines.push('');
    });

    lines.push('---', '由 Simone 自动整理');
    return lines.join('\n');
}

async function getOrCreateInbox() {
    // 列出现有 inbox
    const listResp = await fetch(`${AGENTMAIL_API}/inboxes`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const listData = await listResp.json();

    if (listData.inboxes && listData.inboxes.length > 0) {
        return listData.inboxes[0].id;
    }

    // 创建新 inbox
    logInfo('创建新的 agentmail inbox...');
    const createResp = await fetch(`${AGENTMAIL_API}/inboxes`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ display_name: 'Simone AI Assistant' })
    });
    const createData = await createResp.json();
    return createData.id;
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
    const toList = recipients.split(',').map(e => e.trim()).filter(Boolean);

    if (toList.length === 0) {
        logError('收件人列表为空');
        process.exit(1);
    }

    // 获取或创建 inbox
    const inboxId = await getOrCreateInbox();
    logInfo(`使用 inbox: ${inboxId}`);

    // 生成邮件内容
    const subject = `🤖 AI 热点新闻 ${date}`;
    const html = generateHtmlEmail(digest);
    const text = generateTextEmail(digest);

    // 发送邮件
    logInfo(`正在发送邮件给 ${toList.length} 位收件人...`);

    const sendResp = await fetch(`${AGENTMAIL_API}/inboxes/${inboxId}/messages/send`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            to: toList,
            subject,
            text,
            html
        })
    });

    const sendData = await sendResp.json();

    if (!sendResp.ok) {
        logError(`发送失败: ${JSON.stringify(sendData)}`);
        process.exit(1);
    }

    logInfo('邮件发送成功！');
    console.log(JSON.stringify({
        success: true,
        messageId: sendData.id || sendData.message_id,
        recipients: toList,
        subject
    }, null, 2));
}

main().catch(err => {
    logError('send-email 执行异常', err.message);
    process.exit(1);
});
