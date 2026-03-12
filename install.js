#!/usr/bin/env node
/**
 * install.js — 将项目下的所有 skills 安装到 ~/.openclaw/skills/ 中
 *
 * 用法: node install.js
 *
 * 自动发现含有 SKILL.md 的目录作为 skill，
 * 同时安装 shared/ 依赖库。已存在的 skill 会被覆盖。
 */

import { readdirSync, cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = path.join(os.homedir(), '.openclaw', 'skills');

// 复制时跳过的目录名
const SKIP = new Set(['node_modules', '.git', '.openclaw']);

function shouldCopy(src) {
    return !SKIP.has(path.basename(src));
}

function findSkills() {
    const skills = [];
    for (const entry of readdirSync(PROJECT_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (existsSync(path.join(PROJECT_DIR, entry.name, 'SKILL.md'))) {
            skills.push(entry.name);
        }
    }
    return skills;
}

function installDir(name, src) {
    const dest = path.join(TARGET_DIR, name);
    // 先清除旧目录，确保完全覆盖（删除已不存在的旧文件）
    if (existsSync(dest)) rmSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true, filter: shouldCopy });
    return dest;
}

function main() {
    const skills = findSkills();
    console.log(`[INFO] 发现 ${skills.length} 个 skill: ${skills.join(', ')}`);

    mkdirSync(TARGET_DIR, { recursive: true });

    // 1. 安装 shared 库（所有 skill 通过相对路径 ../../shared/lib/ 引用）
    const sharedSrc = path.join(PROJECT_DIR, 'shared');
    if (existsSync(sharedSrc)) {
        const dest = installDir('shared', sharedSrc);
        console.log(`[INFO] 安装共享库: shared/ -> ${dest}`);
    }

    // 2. 安装各 skill
    for (const skill of skills) {
        const dest = installDir(skill, path.join(PROJECT_DIR, skill));
        console.log(`[INFO] 安装 skill: ${skill}/ -> ${dest}`);
    }

    console.log(`\n[INFO] 安装完成！共 ${skills.length} 个 skill + shared 库 -> ${TARGET_DIR}`);
}

main();
