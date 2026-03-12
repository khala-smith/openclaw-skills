/**
 * gather-context.js — 为 Product Manager 采集项目上下文
 *
 * 用法: node gather-context.js "<ProjectName>"
 * 输出: JSON 到 stdout
 */

import fs from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

import { fetchProjectInfo, fetchProjectIssues, getRepoUrl, extractRepoName } from '../../shared/lib/linear.js';
import { getWorkspaceDir, getOpenClawDir } from '../../shared/lib/config.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

async function main() {
    const projectName = process.argv[2];
    if (!projectName) {
        logError('请提供 Project 名称，例如: node gather-context.js "Khala Frontend"');
        process.exit(1);
    }

    logInfo(`采集 Project [${projectName}] 上下文...`);

    // 1. 获取 Linear 项目信息
    const project = await fetchProjectInfo(projectName);
    if (!project) {
        logError(`未找到名为 [${projectName}] 的 Linear 项目`);
        process.exit(1);
    }

    // 2. 获取所有 issues 并按状态分组
    const issues = await fetchProjectIssues(projectName);
    const issuesByState = {};
    for (const issue of issues) {
        const state = issue.state.name;
        if (!issuesByState[state]) issuesByState[state] = [];
        issuesByState[state].push({
            identifier: issue.identifier,
            title: issue.title,
            priority: issue.priority,
            labels: issue.labels?.nodes?.map(l => l.name) || [],
            hasChildren: (issue.children?.nodes?.length || 0) > 0
        });
    }

    // 3. 读取 Repo README
    let readme = null;
    const repoUrl = getRepoUrl(project);
    if (repoUrl) {
        const repoName = extractRepoName(repoUrl);
        const repoDir = path.join(getWorkspaceDir(), 'codex-dev-projects', repoName);
        const readmePath = path.join(repoDir, 'README.md');

        if (!existsSync(repoDir) && repoUrl) {
            logInfo('仓库未克隆，尝试获取 README...');
            try {
                execSync(`git clone --depth 1 ${repoUrl} "${repoDir}"`, { stdio: 'ignore' });
            } catch { /* 忽略克隆失败 */ }
        }

        if (existsSync(readmePath)) {
            readme = readFileSync(readmePath, 'utf8');
        }
    }

    // 4. 读取已有 feature specs
    const openclawDir = getOpenClawDir();
    const featuresDir = path.join(openclawDir, 'features');
    const existingFeatures = [];
    if (existsSync(featuresDir)) {
        for (const file of readdirSync(featuresDir).filter(f => f.endsWith('.md'))) {
            existingFeatures.push({
                filename: file,
                content: readFileSync(path.join(featuresDir, file), 'utf8')
            });
        }
    }

    // 5. 读取 PROJECT_CONTEXT.md
    let projectContext = null;
    const contextPath = path.join(openclawDir, 'PROJECT_CONTEXT.md');
    if (existsSync(contextPath)) {
        projectContext = readFileSync(contextPath, 'utf8');
    }

    // 输出结果
    const result = {
        project: {
            name: project.name,
            description: project.description,
            state: project.state,
            progress: project.progress,
            repoUrl
        },
        issuesByState,
        totalIssues: issues.length,
        readme,
        existingFeatures,
        projectContext
    };

    console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
    logError('gather-context 执行异常', err.message);
    process.exit(1);
});
