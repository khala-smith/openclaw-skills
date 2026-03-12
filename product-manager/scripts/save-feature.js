/**
 * save-feature.js — 保存 Feature Spec 并在 Linear 创建 feature-request issue
 *
 * 用法: node save-feature.js "<ProjectName>" "<featureFilePath>"
 */

import fs from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

import { fetchProjectInfo, fetchProjectIssues, createIssue, findOrCreateLabel, getRepoUrl } from '../../shared/lib/linear.js';
import { getOpenClawDir } from '../../shared/lib/config.js';
import { logInfo, logError } from '../../shared/lib/logger.js';

async function main() {
    const projectName = process.argv[2];
    const featureFilePath = process.argv[3];

    if (!projectName || !featureFilePath) {
        logError('用法: node save-feature.js "<ProjectName>" "<featureFilePath>"');
        process.exit(1);
    }

    if (!existsSync(featureFilePath)) {
        logError(`文件不存在: ${featureFilePath}`);
        process.exit(1);
    }

    const content = readFileSync(featureFilePath, 'utf8');

    // 从内容中提取标题
    const titleMatch = content.match(/^#\s+Feature:\s*(.+)$/m);
    const featureTitle = titleMatch ? titleMatch[1].trim() : path.basename(featureFilePath, '.md');

    // 1. 保存到 .openclaw/features/
    const openclawDir = getOpenClawDir();
    const featuresDir = path.join(openclawDir, 'features');
    await fs.mkdir(featuresDir, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const slug = featureTitle.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
    const targetFilename = `${dateStr}-${slug}.md`;
    const targetPath = path.join(featuresDir, targetFilename);

    await fs.copyFile(featureFilePath, targetPath);
    logInfo(`Feature Spec 已保存到: ${targetPath}`);

    // 2. 在 Linear 创建 feature-request issue
    const project = await fetchProjectInfo(projectName);
    if (!project) {
        logError(`未找到 Linear 项目: ${projectName}`);
        process.exit(1);
    }

    // 获取 team id（从项目已有 issue 中推断）
    const issues = await fetchProjectIssues(projectName);
    if (issues.length === 0) {
        logError('项目中没有任何 issue，无法确定 team。请先在 Linear 中手动创建一个 issue。');
        process.exit(1);
    }

    const teamId = issues[0].team.id;
    const labelId = await findOrCreateLabel(teamId, 'feature-request');

    const issue = await createIssue({
        teamId,
        projectId: project.id,
        title: `[Feature] ${featureTitle}`,
        description: content,
        priority: 2, // High
        labelIds: labelId ? [labelId] : []
    });

    if (issue) {
        logInfo(`✅ Linear Issue 已创建: ${issue.identifier} — ${issue.url}`);
    } else {
        logError('Linear Issue 创建失败');
    }
}

main().catch(err => {
    logError('save-feature 执行异常', err.message);
    process.exit(1);
});
