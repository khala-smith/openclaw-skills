/**
 * gather-context.js — 为 Tech Lead 采集 Feature Spec + 代码库上下文
 *
 * 用法: node gather-context.js "<ProjectName>" [featureId]
 * 输出: JSON 到 stdout
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

import { fetchProjectInfo, fetchProjectIssues, fetchNextTodoIssue, fetchIssueById, getRepoUrl, extractRepoName } from '../../shared/lib/linear.js';
import { getWorkspaceDir, getOpenClawDir } from '../../shared/lib/config.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

// 读取关键文件内容（限制大小避免输出过长）
function readFileSafe(filePath, maxLines = 200) {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + `\n... (truncated, ${lines.length - maxLines} more lines)`;
    }
    return content;
}

// 获取仓库文件树
function getFileTree(dir, prefix = '', depth = 0, maxDepth = 4) {
    if (depth > maxDepth) return '';
    const IGNORE = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', 'coverage', '__pycache__', '.openclaw'];
    let tree = '';
    try {
        const entries = readdirSync(dir, { withFileTypes: true })
            .filter(e => !IGNORE.includes(e.name) && !e.name.startsWith('.'))
            .sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const childPrefix = isLast ? '    ' : '│   ';

            tree += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
            if (entry.isDirectory()) {
                tree += getFileTree(path.join(dir, entry.name), prefix + childPrefix, depth + 1, maxDepth);
            }
        }
    } catch { /* 忽略权限错误 */ }
    return tree;
}

async function main() {
    const projectName = process.argv[2];
    const featureId = process.argv[3]; // 可选

    if (!projectName) {
        logError('用法: node gather-context.js "<ProjectName>" [featureId]');
        process.exit(1);
    }

    logInfo(`采集 Tech Lead 上下文: Project=[${projectName}], Feature=[${featureId || 'auto'}]`);

    // 1. 获取 Feature Spec
    let feature = null;

    if (featureId) {
        // 指定了 feature issue id
        const issue = await fetchIssueById(featureId);
        if (issue) {
            feature = { identifier: issue.identifier, title: issue.title, description: issue.description, source: 'linear' };
        }
    }

    if (!feature) {
        // 自动选择优先级最高的 feature-request issue
        const nextFeature = await fetchNextTodoIssue(projectName, 'feature-request');
        if (nextFeature) {
            feature = { identifier: nextFeature.identifier, title: nextFeature.title, description: nextFeature.description, source: 'linear' };
        }
    }

    if (!feature) {
        // 从本地 features 目录找最新的
        const openclawDir = getOpenClawDir();
        const featuresDir = path.join(openclawDir, 'features');
        if (existsSync(featuresDir)) {
            const files = readdirSync(featuresDir).filter(f => f.endsWith('.md')).sort().reverse();
            if (files.length > 0) {
                const content = readFileSync(path.join(featuresDir, files[0]), 'utf8');
                feature = { filename: files[0], description: content, source: 'local' };
            }
        }
    }

    if (!feature) {
        logError('未找到任何 Feature Spec。请先运行 Product Manager 定义功能。');
        process.exit(1);
    }

    // 2. 获取项目信息和代码库
    const project = await fetchProjectInfo(projectName);
    const repoUrl = project ? getRepoUrl(project) : null;

    let codebaseTree = null;
    let keyFiles = {};

    if (repoUrl) {
        const repoName = extractRepoName(repoUrl);
        const repoDir = path.join(getWorkspaceDir(), 'codex-dev-projects', repoName);

        // 确保 repo 存在且最新
        if (!existsSync(repoDir)) {
            logInfo('克隆仓库...');
            try {
                execSync(`git clone ${repoUrl} "${repoDir}"`, { stdio: 'ignore' });
            } catch (e) {
                logError('Git Clone 失败', e.message);
            }
        } else {
            try {
                execSync('git fetch origin', { cwd: repoDir, stdio: 'ignore' });
                const branches = execSync('git branch -r', { cwd: repoDir }).toString();
                const defaultBranch = (branches.includes('origin/master') && !branches.includes('origin/main')) ? 'master' : 'main';
                execSync(`git checkout ${defaultBranch} && git pull origin ${defaultBranch}`, { cwd: repoDir, stdio: 'ignore' });
            } catch { /* 忽略 pull 错误 */ }
        }

        if (existsSync(repoDir)) {
            codebaseTree = getFileTree(repoDir);

            // 读取关键文件
            const keyFileNames = ['README.md', 'CLAUDE.md', 'package.json', 'tsconfig.json', '.env.example'];
            for (const name of keyFileNames) {
                const content = readFileSafe(path.join(repoDir, name), 150);
                if (content) keyFiles[name] = content;
            }

            // 尝试发现入口文件
            for (const entry of ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js', 'index.ts', 'index.js']) {
                const content = readFileSafe(path.join(repoDir, entry), 100);
                if (content) { keyFiles[entry] = content; break; }
            }
        }
    }

    // 3. 获取已有设计文档
    const openclawDir = getOpenClawDir();
    const designsDir = path.join(openclawDir, 'designs');
    const existingDesigns = [];
    if (existsSync(designsDir)) {
        for (const file of readdirSync(designsDir).filter(f => f.endsWith('.md'))) {
            existingDesigns.push({
                filename: file,
                content: readFileSafe(path.join(designsDir, file), 100)
            });
        }
    }

    // 输出
    const result = {
        feature,
        project: project ? { name: project.name, description: project.description, repoUrl } : null,
        codebaseTree,
        keyFiles,
        existingDesigns
    };

    console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
    logError('gather-context 执行异常', err.message);
    process.exit(1);
});
