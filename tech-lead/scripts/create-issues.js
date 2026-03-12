/**
 * create-issues.js — 从 JSON 批量创建 Linear issues（挂在 feature issue 下）
 *
 * 用法: node create-issues.js "<ProjectName>" "<issuesJsonPath>"
 *
 * JSON 格式:
 * {
 *   "parentIssueId": "<feature-request issue 的内部 id>",
 *   "tasks": [
 *     { "title": "...", "description": "...", "priority": 1 }
 *   ]
 * }
 */

import { readFileSync, existsSync } from 'fs';

import { fetchProjectInfo, fetchProjectIssues, fetchIssueById, createIssue, findOrCreateLabel, updateIssueState } from '../../shared/lib/linear.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

async function main() {
    const projectName = process.argv[2];
    const issuesJsonPath = process.argv[3];

    if (!projectName || !issuesJsonPath) {
        logError('用法: node create-issues.js "<ProjectName>" "<issuesJsonPath>"');
        process.exit(1);
    }

    if (!existsSync(issuesJsonPath)) {
        logError(`文件不存在: ${issuesJsonPath}`);
        process.exit(1);
    }

    const payload = JSON.parse(readFileSync(issuesJsonPath, 'utf8'));
    const { parentIssueId, tasks } = payload;

    if (!tasks || tasks.length === 0) {
        logError('JSON 中没有 tasks');
        process.exit(1);
    }

    // 获取项目信息
    const project = await fetchProjectInfo(projectName);
    if (!project) {
        logError(`未找到 Linear 项目: ${projectName}`);
        process.exit(1);
    }

    // 获取 team id
    const issues = await fetchProjectIssues(projectName);
    if (issues.length === 0) {
        logError('项目中没有 issue，无法确定 team');
        process.exit(1);
    }
    const teamId = issues[0].team.id;

    // 创建或查找 ready-to-dev 标签
    const labelId = await findOrCreateLabel(teamId, 'ready-to-dev');

    logInfo(`开始创建 ${tasks.length} 个子任务...`);

    const createdIssues = [];
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        logInfo(`[${i + 1}/${tasks.length}] 创建: ${task.title}`);

        const issue = await createIssue({
            teamId,
            projectId: project.id,
            title: task.title,
            description: task.description,
            priority: task.priority ?? 3,
            labelIds: labelId ? [labelId] : [],
            parentId: parentIssueId || undefined
        });

        if (issue) {
            createdIssues.push({ identifier: issue.identifier, title: task.title, url: issue.url });
            logInfo(`  ✅ ${issue.identifier} — ${issue.url}`);
        } else {
            logError(`  创建失败: ${task.title}`);
        }
    }

    // 将 parent feature-request 移至 In Progress
    if (parentIssueId) {
        try {
            const parentIssue = await fetchIssueById(parentIssueId);
            if (parentIssue) {
                const startedStates = parentIssue.team.states.nodes.filter(s => s.type === 'started');
                const inProgressState = startedStates.find(s => s.name.toLowerCase() === 'in progress')
                    || startedStates.find(s => !s.name.toLowerCase().includes('review'))
                    || startedStates[0];

                if (inProgressState) {
                    await updateIssueState(parentIssue.id, inProgressState.id);
                    logInfo(`Parent issue 已移至: [${inProgressState.name}]`);
                }
            }
        } catch (e) {
            logError('更新 parent issue 状态失败', e.message);
        }
    }

    logInfo(`\n✅ 完成！共创建 ${createdIssues.length}/${tasks.length} 个子任务。`);
    console.log(JSON.stringify(createdIssues, null, 2));
}

main().catch(err => {
    logError('create-issues 执行异常', err.message);
    process.exit(1);
});
