---
name: fullstack-dev
description: Acts as the Fullstack Developer for a Linear Project. Trigger when user says "work on <ProjectName>" or asks to start development tasks for a project. First queries the Linear API to resolve the project and its GitHub repo, picks up the highest-priority `ready-to-dev` issue, gathers design context and codebase intelligence, assembles an enhanced prompt with harness engineering rules and implementation tracking, then launches the Codex autonomous agent in an isolated git worktree.
---

# fullstack-dev

你是 OpenClaw 开发团队中的 **Fullstack Developer**。你的职责是将 Tech Lead 拆分好的 Linear issue 转化为可执行的 Codex prompt，并在隔离环境中驱动 Codex 完成自主开发。

## 触发条件

当用户输入以下指令时激活：
- `work on <ProjectName>` — 自动拉取指定 Linear 项目的下一个开发任务并启动 Codex Agent
- "开发 \<ProjectName\>" 等中文变体

`<ProjectName>` 是 Linear 上的项目名称（如 `Khala Frontend`）。脚本会通过 Linear API 查询该项目并自动获取关联的 GitHub 仓库。

## 与 codex-dev 的区别

`fullstack-dev` 是 `codex-dev` 的增强版本，核心改进：
- **Design Context 注入**：自动检索相关设计文档，注入到 prompt 中
- **Codebase Intelligence**：自动发现相关文件和代码模式
- **增强 Harness Rules**：更完善的工程约束规则
- **Implementation Tracking**：执行过程中持续跟踪进度

## 执行命令

**启动任务**

```bash
node ~/.openclaw/skills/fullstack-dev/scripts/start-task.js "<ProjectName>"
```

自动执行以下流程：

### Phase 1: 前置检查 & 任务选取（Linear API → Issue）
1. 读取 `~/.codex/sessions/` 数据检查 Codex 额度（余量 < 10% 则暂停）
2. 调用 Linear GraphQL API，查询该 Project 下优先级最高的 `ready-to-dev` 标签 Todo issue
3. 如果没有 `ready-to-dev` 的 issue，fallback 到任意 Todo issue（兼容 codex-dev 模式）
4. 从 issue 的 Project External Links 中提取标题含 "Repo" 的 GitHub 仓库 URL

### Phase 2: 仓库准备 & 上下文组装（Repo → Worktree → Context）
1. 如仓库未本地克隆，自动 `git clone`；已存在则 `git fetch && git pull` 拉取最新代码
2. 创建 Git Worktree 隔离开发环境
3. **Issue Context** — 从 Linear issue 获取 title、description、验收标准
4. **Design Context** — 查找 `.openclaw/designs/` 下与 parent feature 相关的设计文档
5. **Codebase Context** — 在目标仓库中：
   - 读取 CLAUDE.md / README.md 获取项目概览
   - 读取 package.json 获取技术栈信息
   - 根据 issue description 中的 "涉及文件" 段自动读取相关源码
6. **Harness Rules** — 应用标准化工程约束规则集

### Phase 3: Prompt 组装

生成的 prompt 结构如下：

```
# TASK: [ISSUE-ID] <Title>

## OBJECTIVE
<来自 issue description 的目标描述>

## DESIGN CONTEXT
<来自设计文档的相关章节>

## CODEBASE CONTEXT
### 项目概览
<来自 README / CLAUDE.md>
### 技术栈
<来自 package.json>
### 相关源码
<自动提取的相关文件内容>

## ACCEPTANCE CRITERIA
<来自 issue description 的验收标准>

## HARNESS ENGINEERING RULES
1. EXPLORE FIRST: 先读代码库，理解现有架构和模式，再动手写代码
2. INCREMENTAL: 每个逻辑步骤完成后就 commit，保持小步前进
3. CONSISTENCY: 严格遵循代码库已有的代码风格、命名约定和设计模式
4. VERIFY: 每次修改后运行 linter、类型检查和测试
5. FIX FORWARD: 测试失败时，读错误输出并修复代码，不要跳过或禁用测试
6. MINIMAL DIFF: 只修改必要的内容，不重构无关代码
7. PR READY: 代码必须 commit、push，并创建引用 [ISSUE-ID] 的 GitHub PR
8. TRACKING: 每完成一个验收标准，输出 [PROGRESS] 标记到日志

## IMPLEMENTATION TRACKING
完成每个验收标准后，输出以下格式的进度日志：
[PROGRESS] AC-1: ✅ <描述>
[PROGRESS] AC-2: ✅ <描述>
```

### Phase 4: 隔离环境 & Agent 启动
1. 从 Linear Project 外部链接提取 GitHub repo URL
2. Clone 或 Pull 最新代码到 `<workspace>/codex-dev-projects/<repo>/`
3. 创建 Git Worktree: `<ISSUE-ID>-worktree`，分支: `feat/<ISSUE-ID>-<slug>`
4. 安装依赖（如存在 package.json）
5. 将 prompt 写入 `.openclaw/prompts/<ISSUE-ID>.txt`
6. 生成 runner 脚本并在 tmux session 中启动 `codex exec`

### Phase 5: Post-Hook 回调
Agent 执行完毕后自动触发：
1. 解析日志中的 `[PROGRESS]` 标记统计完成度
2. 检查 GitHub PR 是否已创建
3. 如 PR 存在 → 将 Linear issue 移至 `In Review`
4. 发送 macOS 通知

**审计与清理**

```bash
node ~/.openclaw/skills/fullstack-dev/scripts/check-task.js "<ProjectName>"
```

输出项目所有 issue 的状态报告，并自动清理已完成/已取消 issue 的 worktree 和分支。

## 参数

- `<ProjectName>` — Linear 项目名称（含空格时用引号包裹）
- `--post-hook` — 内部参数，由 runner 脚本自动调用

## 前置依赖

- `git`, `gh` (GitHub CLI), `tmux`, `codex` 已安装
- `~/.openclaw/openclaw.json` 中配置了 Linear API Key
- Linear Project 的 External Links 中有标题包含 "Repo" 的 GitHub 链接
