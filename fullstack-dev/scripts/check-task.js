/**
 * check-task.js — 审计项目任务状态 & 清理已完成的 worktree
 *
 * 用法: node check-task.js "<ProjectName>"
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

import { fetchProjectInfo, fetchProjectIssues, getRepoUrl, extractRepoName } from '../../shared/lib/linear.js';
import { getWorkspaceDir } from '../../shared/lib/config.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

async function main() {
    const projectName = process.argv[2];
    if (!projectName) {
        logError('用法: node check-task.js "<ProjectName>"');
        process.exit(1);
    }

    logInfo(`获取 Project [${projectName}] 下的所有任务...`);
    const issues = await fetchProjectIssues(projectName);

    if (issues.length === 0) {
        logInfo(`✅ Project [${projectName}] 下没有找到任何任务。`);
        console.log(JSON.stringify({}));
        process.exit(0);
    }

    const stateIssues = {};
    const cleanupCandidates = [];
    let repoUrl = null;

    for (const issue of issues) {
        const stateName = issue.state.name;
        if (!stateIssues[stateName]) stateIssues[stateName] = [];
        stateIssues[stateName].push({
            identifier: issue.identifier,
            title: issue.title,
            labels: issue.labels?.nodes?.map(l => l.name) || []
        });

        if (issue.state.type === 'completed' || issue.state.type === 'canceled') {
            cleanupCandidates.push(issue.identifier);
        }

        if (!repoUrl) {
            repoUrl = getRepoUrl(issue.project);
        }
    }

    logInfo('===== 状态统计 =====');
    console.log(JSON.stringify(stateIssues, null, 2));
    logInfo('====================');

    if (cleanupCandidates.length === 0) {
        logInfo('没有需要清理的已完成/已取消任务。');
        process.exit(0);
    }

    if (!repoUrl) {
        logError('无法在 Project External Links 中找到 Repo，跳过清理');
        process.exit(0);
    }

    const repoName = extractRepoName(repoUrl);
    const targetRepoDir = path.join(getWorkspaceDir(), 'codex-dev-projects', repoName);

    if (!existsSync(targetRepoDir)) {
        logInfo(`项目目录不存在: ${targetRepoDir}。跳过清理。`);
        process.exit(0);
    }

    logInfo(`开始清理: ${cleanupCandidates.join(', ')}`);

    for (const issueId of cleanupCandidates) {
        const worktreePath = path.resolve(targetRepoDir, '..', `${issueId}-worktree`);

        if (existsSync(worktreePath)) {
            logInfo(`🧹 删除 Worktree: ${worktreePath}`);
            try {
                execSync(`git worktree remove -f "${worktreePath}"`, { cwd: targetRepoDir, stdio: 'ignore' });
            } catch {
                try { execSync(`rm -rf "${worktreePath}"`, { stdio: 'ignore' }); } catch { /* 忽略 */ }
            }
        }

        try {
            const branches = execSync(`git branch --list "feat/${issueId}-*"`, { cwd: targetRepoDir })
                .toString().split('\n').map(b => b.trim().replace(/^\*\s*/, '')).filter(Boolean);
            for (const branch of branches) {
                logInfo(`🌿 删除分支: ${branch}`);
                execSync(`git branch -D ${branch}`, { cwd: targetRepoDir, stdio: 'ignore' });
            }
        } catch { /* 忽略 */ }
    }

    logInfo('✅ 清理完成！');
}

main().catch(err => {
    logError('check-task 执行异常', err.message);
    process.exit(1);
});
