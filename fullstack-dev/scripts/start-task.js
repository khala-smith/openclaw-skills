import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { 
    fetchProjectIssues, 
    fetchNextTodoIssue, 
    fetchIssueById, 
    updateIssueState, 
    getRepoUrl, 
    extractRepoName 
} from '../../shared/lib/linear.js';
import { getWorkspaceDir, getOpenClawDir } from '../../shared/lib/config.js';
import { logInfo, logError, logDebug } from '../../shared/lib/logger.js';
import { checkCodexUsage } from './check-usage.js';

// -----------------------------------------------------------------
// 环境与全局配置
// -----------------------------------------------------------------
const isDebug = process.env.DEBUG === 'true';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(process.cwd());
const OPENCLAW_DIR = getOpenClawDir();
const TASKS_FILE = path.join(OPENCLAW_DIR, 'active-tasks.json');
const PROMPTS_DIR = path.join(OPENCLAW_DIR, 'prompts');
const LOGS_DIR = path.join(OPENCLAW_DIR, 'logs');
const RUNNERS_DIR = path.join(OPENCLAW_DIR, 'runners');
const DESIGNS_DIR = path.join(OPENCLAW_DIR, 'designs');

// =================================================================
// 辅助工具
// =================================================================
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function safeReadFile(filePath) {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

// 自动匹配 target 仓库下的文件
async function extractRelevantFiles(worktreePath, descriptionText) {
    if (!descriptionText) return '';
    
    // 粗略匹配如 `src/components/Button.tsx` 的文件路径
    const regex = /`?([a-zA-Z0-9_\-\/]+\.(js|ts|jsx|tsx|md|json|html|css))`?/g;
    const matches = [...descriptionText.matchAll(regex)];
    const filePaths = [...new Set(matches.map(m => m[1]))]; // dedup
    
    let contentStr = '';
    for (const file of filePaths) {
        const fullPath = path.join(worktreePath, file);
        if (await fileExists(fullPath)) {
            const content = await safeReadFile(fullPath);
            if (content) {
                contentStr += `\n==== FILE: ${file} ====\n\`\`\`\n${content}\n\`\`\`\n`;
            }
        }
    }
    return contentStr;
}

// =================================================================
// 后置钩子模式 (Post-Hook Mode)
// =================================================================
async function runPostHook(issueIdentifier, exitCode, branchName, worktreePath, logPath) {
    logInfo(`[POST-HOOK] 触发后置钩子，目标任务: ${issueIdentifier}，退出码: ${exitCode}`);
    const isSuccess = exitCode === '0';

    // 1. 解析进度日志与 Token
    let tokenInfo = "未找到 Token 消耗数据";
    let progressLog = [];
    if (existsSync(logPath)) {
        const logContent = readFileSync(logPath, 'utf8');
        const lines = logContent.split('\n');
        
        const tokenMatches = lines.filter(l => /(token|cost|usage)/i.test(l)).slice(-3);
        if (tokenMatches.length > 0) tokenInfo = tokenMatches.join(' | ');

        // Implementation Tracking
        progressLog = lines.filter(l => l.includes('[PROGRESS]'));
    }

    if (progressLog.length > 0) {
        logInfo(`[POST-HOOK] Agent 进度汇报:`);
        progressLog.forEach(l => logInfo(`  ${l}`));
    }

    // 2. 失败处理
    if (!isSuccess) {
        logInfo(`[POST-HOOK] Agent 执行失败。`);
        execSync(`osascript -e 'display notification "Token: ${tokenInfo}" with title "❌ 任务异常退出" subtitle "${issueIdentifier} 遇到报错"'`);
        return;
    }

    // 3. 成功处理：检查 GitHub PR
    logInfo(`[POST-HOOK] Agent 执行成功，开始检查 GitHub PR...`);
    let prUrl = null;
    try {
        const prOutput = execSync(`gh pr list --head ${branchName} --json url`, { cwd: worktreePath }).toString();
        const prs = JSON.parse(prOutput);
        if (prs.length > 0) prUrl = prs[0].url;
    } catch (e) {
        logError('检查 PR 失败，请确认是否安装并登录了 gh cli', e.message);
    }

    if (!prUrl) {
        logInfo(`[POST-HOOK] 未检测到 PR。可能 Agent 只是完成了本地验证。`);
        execSync(`osascript -e 'display notification "未检测到对应分支的 PR" with title "⚠️ 任务完成但无 PR" subtitle "${issueIdentifier}"'`);
        // 不流转状态
        return;
    }

    // 4. 存在 PR，执行 Linear 状态流转 (In Progress -> In Review)
    logInfo(`[POST-HOOK] 检测到 PR: ${prUrl}。准备更新 Linear 状态...`);
    const issueData = await fetchIssueById(issueIdentifier);

    const reviewState = issueData.team.states.nodes.find(s => s.name.toLowerCase() === 'in review') ||
        issueData.team.states.nodes.find(s => s.type === 'completed');

    if (reviewState) {
        await updateIssueState(issueData.id, reviewState.id);
        logInfo(`[POST-HOOK] 已将 Linear Issue 移至: [${reviewState.name}]`);
    }

    // 5. 最终成功通知
    execSync(`osascript -e 'display notification "PR 已自动创建并移至 Review" with title "✅ ${issueIdentifier} 开发完成" subtitle "Token: ${tokenInfo}"'`);
}

// =================================================================
// 启动模式 (Start Mode)
// =================================================================
async function main() {
    // 拦截器：钩子模式
    if (process.argv[2] === '--post-hook') {
        const [, , , issueId, exitCode, branch, wtPath, lPath] = process.argv;
        await runPostHook(issueId, exitCode, branch, wtPath, lPath);
        process.exit(0);
    }

    const projectName = process.argv[2];
    if (!projectName) {
        logError('用法: node start-task.js "<ProjectName>"');
        process.exit(1);
    }

    logInfo(`[Phase 1] 前置检查...`);
    const usageCheck = checkCodexUsage(10);
    if (!usageCheck.ok) {
        logError(`Codex 余额不足: ${usageCheck.message}`);
        process.exit(0);
    }
    logInfo(usageCheck.message);

    logInfo(`获取 Project [${projectName}] 下优先待办任务...`);
    // 优先拿 ready-to-dev 的
    let issueData = await fetchNextTodoIssue(projectName, 'ready-to-dev');
    if (!issueData) {
        logInfo(`未找到 'ready-to-dev' 的任务，回退查找任意 unstarted 任务...`);
        issueData = await fetchNextTodoIssue(projectName);
    }
    
    if (!issueData) {
        logInfo(`✅ Project [${projectName}] 下没有找到需要开发的需求。`);
        process.exit(0);
    }

    logInfo(`选定需求: [${issueData.identifier}] ${issueData.title} (Priority: ${issueData.priority})`);

    // --- A. Linear 状态流转 (Todo -> In Progress) ---
    const startedStates = issueData.team.states.nodes.filter(s => s.type === 'started');
    let inProgressState = startedStates.find(s => s.name.toLowerCase() === 'in progress') || 
                          startedStates.find(s => !s.name.toLowerCase().includes('review')) || 
                          startedStates[0];

    if (inProgressState && issueData.state.name !== inProgressState.name) {
        logInfo(`更新 Linear 状态为: [${inProgressState.name}]...`);
        await updateIssueState(issueData.id, inProgressState.id);
    }

    // --- B. 获取 Repo 与 Worktree 准备 ---
    const repoUrl = getRepoUrl(issueData.project);
    if (!repoUrl) {
        logError(`无法在 Project 的 External Links 中找到 Repo。`);
        process.exit(1);
    }

    const repoName = extractRepoName(repoUrl);
    const workspaceDir = getWorkspaceDir();
    const codexProjectsDir = path.join(workspaceDir, 'codex-dev-projects');
    
    await fs.mkdir(codexProjectsDir, { recursive: true });
    const targetRepoDir = path.join(codexProjectsDir, repoName);

    if (!existsSync(targetRepoDir)) {
        logInfo(`[Git] 目录不存在，Clone ${repoUrl} ...`);
        execSync(`git clone ${repoUrl} "${targetRepoDir}"`, { stdio: isDebug ? 'inherit' : 'ignore' });
    } else {
        logInfo(`[Git] 进入目标目录，拉取最新代码...`);
        execSync(`git fetch origin`, { cwd: targetRepoDir, stdio: 'ignore' });
        let defaultBranch = 'main';
        const branches = execSync(`git branch -r`, { cwd: targetRepoDir }).toString();
        if (branches.includes('origin/master') && !branches.includes('origin/main')) defaultBranch = 'master';
        
        execSync(`git checkout ${defaultBranch}`, { cwd: targetRepoDir, stdio: 'ignore' });
        execSync(`git pull origin ${defaultBranch}`, { cwd: targetRepoDir, stdio: isDebug ? 'inherit' : 'ignore' });
    }

    const safeTitle = issueData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const branchName = `feat/${issueData.identifier}-${safeTitle}`;
    const worktreePath = path.resolve(targetRepoDir, '..', `${issueData.identifier}-worktree`);

    logInfo(`配置隔离开发环境 (Worktree): ${worktreePath}`);
    if (existsSync(worktreePath)) {
        try { execSync(`git worktree remove -f "${worktreePath}"`, { cwd: targetRepoDir, stdio: 'ignore' }); }
        catch (e) { execSync(`rm -rf "${worktreePath}"`, { stdio: 'ignore' }); }
    }

    let baseBranch = 'origin/main';
    try {
        const remoteBranches = execSync(`git branch -r`, { cwd: targetRepoDir }).toString();
        if (remoteBranches.includes('origin/master') && !remoteBranches.includes('origin/main')) baseBranch = 'origin/master';
    } catch (e) { baseBranch = 'HEAD'; }

    let branchExists = false;
    try { execSync(`git rev-parse --verify ${branchName}`, { cwd: targetRepoDir, stdio: 'ignore' }); branchExists = true; } catch (e) { }

    try {
        if (branchExists) execSync(`git worktree add "${worktreePath}" ${branchName}`, { cwd: targetRepoDir, stdio: isDebug ? 'inherit' : 'ignore' });
        else execSync(`git worktree add "${worktreePath}" -b ${branchName} ${baseBranch}`, { cwd: targetRepoDir, stdio: isDebug ? 'inherit' : 'ignore' });

        if (existsSync(path.join(worktreePath, 'package.json'))) {
            logInfo(`📦 安装隔离区依赖...`);
            execSync(`npm install`, { cwd: worktreePath, stdio: isDebug ? 'inherit' : 'ignore' });
        }
    } catch (e) {
        logError('Worktree 创建失败', e.message); process.exit(1);
    }

    // --- C. Context Assembling ---
    logInfo(`[Phase 2] 装配上下文文档...`);
    
    // 1. Design Context
    let designContextStr = '没有找到明确的设计文档。';
    if (issueData.parent) {
        const parentId = issueData.parent.identifier;
        let designFileMatch = null;
        if (existsSync(DESIGNS_DIR)) {
            const files = await fs.readdir(DESIGNS_DIR);
            designFileMatch = files.find(f => f.includes(parentId) && f.endsWith('.md'));
        }
        if (designFileMatch) {
            const designContent = await safeReadFile(path.join(DESIGNS_DIR, designFileMatch));
            if (designContent) {
                designContextStr = `这是对应的上级特性 (${parentId}) 设计文档：\n\n${designContent}`;
                logInfo(`  -> 注入设计文档: ${designFileMatch}`);
            }
        }
    }

    // 2. Codebase Context
    let projectOverviewStr = '无。';
    const readmes = [await safeReadFile(path.join(worktreePath, 'CLAUDE.md')), await safeReadFile(path.join(worktreePath, 'README.md'))].filter(Boolean);
    if (readmes.length > 0) projectOverviewStr = readmes[0];

    let techStackStr = '无。';
    const pkgJson = await safeReadFile(path.join(worktreePath, 'package.json'));
    if (pkgJson) {
        try {
            const parsed = JSON.parse(pkgJson);
            techStackStr = `Dependencies:\n${JSON.stringify(parsed.dependencies || {}, null, 2)}\nDevDependencies:\n${JSON.stringify(parsed.devDependencies || {}, null, 2)}`;
        } catch { }
    }

    const relevantFilesStr = await extractRelevantFiles(worktreePath, issueData.description);
    if (relevantFilesStr) logInfo(`  -> 提取到相关源码文件注入 Prompt。`);

    // --- D. 生成 Prompt ---
    await fs.mkdir(PROMPTS_DIR, { recursive: true });
    const promptPath = path.join(PROMPTS_DIR, `${issueData.identifier}.txt`);
    const promptContent = `
# TASK: [${issueData.identifier}] ${issueData.title}

## OBJECTIVE
${issueData.description || 'N/A'}

## DESIGN CONTEXT
${designContextStr}

## CODEBASE CONTEXT
### 项目概览
${projectOverviewStr}

### 技术栈
${techStackStr}

### 相关源码
${relevantFilesStr || '（需自行搜索提取）'}

## HARNESS ENGINEERING RULES
1. EXPLORE FIRST: 先读代码库，理解现有架构和模式，再动手写代码
2. INCREMENTAL: 每个逻辑步骤完成后就 commit，保持小步前进
3. CONSISTENCY: 严格遵循代码库已有的代码风格、命名约定和设计模式
4. VERIFY: 每次修改后运行 linter、类型检查和测试
5. FIX FORWARD: 测试失败时，读错误输出并修复代码，不要跳过或禁用测试
6. MINIMAL DIFF: 只修改必要的内容，不重构无关代码
7. PR READY: 代码必须 commit、push，并创建引用 [${issueData.identifier}] 的 GitHub PR
8. TRACKING: 每完成一个验收标准，输出 [PROGRESS] 标记到日志

## IMPLEMENTATION TRACKING
完成每个验收标准后，输出以下格式的进度日志（这非常重要，将用于系统监控）：
[PROGRESS] ✅ <描述>
`.trim();

    await fs.writeFile(promptPath, promptContent, 'utf-8');

    // --- E. 启动 Agent & 注入 Post-Hook 回调 ---
    await fs.mkdir(LOGS_DIR, { recursive: true });
    await fs.mkdir(RUNNERS_DIR, { recursive: true });

    const logPath = path.join(LOGS_DIR, `${issueData.identifier}.log`);
    const runnerPath = path.join(RUNNERS_DIR, `run-${issueData.identifier}.sh`);
    const sessionName = `agent-${issueData.identifier}`;

    const runnerScript = `#!/bin/bash
source ~/.zshrc 2>/dev/null || true
cd "${worktreePath}"

echo "[$(date)] 🚀 开始执行 Fullstack Agent: ${issueData.identifier}" > "${logPath}"

codex exec --model gpt-5.3-codex -c 'model_reasoning_effort=high' --dangerously-bypass-approvals-and-sandbox "$(cat '${promptPath}')" >> "${logPath}" 2>&1
AGENT_EXIT_CODE=$?

echo "[$(date)] 🏁 Agent 执行完毕，退出码: $AGENT_EXIT_CODE" >> "${logPath}"

# 回调触发 Post-Hook 状态流转
node "${__filename}" --post-hook "${issueData.identifier}" "$AGENT_EXIT_CODE" "${branchName}" "${worktreePath}" "${logPath}" >> "${logPath}" 2>&1

exec bash
`;

    await fs.writeFile(runnerPath, runnerScript, { mode: 0o755 });

    try {
        try { execSync(`tmux kill-session -t "${sessionName}" >/dev/null 2>&1`); } catch (e) { }
        execSync(`tmux new-session -d -s "${sessionName}" -c "${worktreePath}" "${runnerPath}"`);
        logInfo(`✅ Tmux 已启动，Fullstack Agent 正在后台工作。`);
        logInfo(`👉 实时监控: tail -f ${logPath}`);
    } catch (e) {
        logError('启动 Tmux 失败', e.message); process.exit(1);
    }
}

main();
