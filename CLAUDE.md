# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **openclaw-skills** repository — a collection of skill modules for the OpenClaw agent framework. Currently contains one skill: `codex-dev`.

## Architecture

### `codex-dev` Skill

An autonomous development orchestrator that connects Linear (project management) to Codex (AI coding agent) via GitHub. The flow:

1. **Quota gate** (`check-usage.js`) — reads `~/.codex/sessions/*.jsonl` to verify Codex API quota has >= 10% remaining
2. **Issue selection** (`start-task.js`) — queries Linear GraphQL API for the highest-priority `unstarted` issue in a given project
3. **Repo provisioning** — extracts GitHub repo URL from the Linear Project's "Repo" external link, clones or pulls into `<workspace>/codex-dev-projects/<repo-name>/`
4. **Worktree isolation** — creates `git worktree` at `<repo-name>/../<ISSUE-ID>-worktree` on branch `feat/<ISSUE-ID>-<slug>`
5. **Agent launch** — generates a prompt file, writes a runner shell script, and spawns a `tmux` session running `codex exec`
6. **Post-hook** (`start-task.js --post-hook`) — on agent completion, checks for a GitHub PR via `gh`, transitions Linear issue to "In Review"
7. **Audit & cleanup** (`check-task.js`) — lists all project issues by state, removes worktrees and branches for completed/canceled issues

### Key Configuration

All config lives in `~/.openclaw/openclaw.json`:
- `agents.defaults.workspace` — base workspace directory (default: `~/.openclaw/workspace`)
- `skills.entries["codex-dev"].apiKey` — Linear API key (also accepts `LINEAR_API_KEY` env var)

Runtime state (prompts, logs, runner scripts, active-tasks) is stored under `.openclaw/` relative to `process.cwd()`.

## Commands

```bash
# Start a task for a Linear project
node codex-dev/scripts/start-task.js "Project Name"

# Audit task states and clean up worktrees
node codex-dev/scripts/check-task.js "Project Name"

# Check Codex quota standalone
node codex-dev/scripts/check-usage.js
```

## Code Conventions

- **ES Modules** (`"type": "module"` in package.json) — use `import`/`export`, not `require`
- **No external npm dependencies** — scripts use only Node.js built-ins and `fetch`
- Code comments and log messages are in **Chinese (Simplified)**
- Commit messages use numbered lists: `1. description 2. description`
- External tools expected at runtime: `git`, `gh` (GitHub CLI), `tmux`
