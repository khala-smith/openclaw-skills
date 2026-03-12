/**
 * config.js — 读取 OpenClaw 全局配置 (~/.openclaw/openclaw.json)
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

let _cache = null;

function loadConfig() {
    if (_cache) return _cache;
    if (!existsSync(CONFIG_PATH)) {
        _cache = {};
        return _cache;
    }
    try {
        _cache = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        _cache = {};
    }
    return _cache;
}

export function getWorkspaceDir() {
    const config = loadConfig();
    let ws = config?.agents?.defaults?.workspace;
    if (!ws) return path.join(os.homedir(), '.openclaw', 'workspace');
    if (ws.startsWith('~/')) ws = path.join(os.homedir(), ws.slice(2));
    return ws;
}

export function getLinearApiKey() {
    const config = loadConfig();
    return config?.skills?.entries?.['codex-dev']?.apiKey
        || process.env.LINEAR_API_KEY
        || null;
}

export function getSkillConfig(skillName) {
    const config = loadConfig();
    return config?.skills?.entries?.[skillName] || {};
}

export function getOpenClawDir() {
    return path.join(process.cwd(), '.openclaw');
}
