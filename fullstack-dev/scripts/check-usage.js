/**
 * check-usage.js — 检查 Codex 额度
 * 从 ~/.codex/sessions/ 读取最近一次 session 的 rate_limits 数据
 *
 * 用法 (standalone):  node check-usage.js
 * 用法 (module):      import { checkCodexUsage } from './check-usage.js';
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

function findLatestSessionFile() {
    const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
    if (!existsSync(sessionsRoot)) return null;

    const allFiles = [];
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.jsonl')) allFiles.push(full);
        }
    }
    walk(sessionsRoot);

    if (allFiles.length === 0) return null;
    allFiles.sort().reverse();
    return allFiles[0];
}

function extractRateLimits(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');

    let lastRateLimits = null;
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            if (entry?.payload?.type === 'token_count' && entry?.payload?.rate_limits) {
                lastRateLimits = entry.payload.rate_limits;
            }
        } catch { /* skip */ }
    }
    return lastRateLimits;
}

export function checkCodexUsage(thresholdPercent = 10) {
    const sessionFile = findLatestSessionFile();
    if (!sessionFile) {
        return { ok: true, remainingPercent: -1, usedPercent: -1, message: '⚠️ 未找到 Codex session 文件，跳过余额检查。' };
    }

    const rateLimits = extractRateLimits(sessionFile);
    if (!rateLimits || !rateLimits.primary) {
        return { ok: true, remainingPercent: -1, usedPercent: -1, message: '⚠️ Session 文件中未找到 rate_limits 数据，跳过余额检查。' };
    }

    const usedPercent = rateLimits.primary.used_percent;
    const remainingPercent = 100 - usedPercent;
    const ok = remainingPercent >= thresholdPercent;

    return {
        ok,
        remainingPercent: Math.round(remainingPercent * 100) / 100,
        usedPercent: Math.round(usedPercent * 100) / 100,
        message: ok
            ? `✅ Codex 余额充足: 剩余 ${remainingPercent.toFixed(1)}%`
            : `⛔ Codex 余额较低: 剩余 ${remainingPercent.toFixed(1)}% (阈值 ${thresholdPercent}%)`
    };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    console.log(JSON.stringify(checkCodexUsage(), null, 2));
}
