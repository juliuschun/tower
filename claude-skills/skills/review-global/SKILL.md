---
name: review-global
description: Periodic situation report across all projects. Produces a timestamped review of what's active, stalled, and needs attention. Run when you've lost the thread.
argument-hint: [--deep | --compare | project-name]
allowed-tools: Bash, Read, Write, Task, Glob, Grep
---

# Review Global — Situation Report

Produce a point-in-time snapshot of everything happening across all projects.
Not a memory system. Not loaded every session. A **periodic review you produce when you need one.**

Reviews are saved as timestamped files. The history shows trajectory over time.

## When To Use

- "What am I working on?" — you've lost context after a break
- "What's the state of everything?" — stepping back to see the big picture
- Weekly check-in — produce a review for yourself or your team
- Before planning — understand the landscape before deciding what's next

## Step 1: Launch Background Scanner

Use the Task tool:
- `subagent_type`: `general-purpose`
- `model`: `haiku`
- `run_in_background`: `true`
- `name`: `review-scanner`

Give the subagent this prompt:

---

You are a project scanner producing a situation report.

**Write the review to `~/.claude/memory/reviews/{YYYY-MM-DD}_{HHMM}.md`** using today's date and current time (e.g. `2026-02-18_1405.md`).
Each review is a standalone snapshot — never append to existing files.

The dev root is `~/Documents/02_Dev/`.

### Scan 1: Session transcripts (what people were actually doing)

Run the session scanner script:
```bash
python3 ~/.claude/skills/review-global/scripts/scan_sessions.py --max-projects 20 --sessions-per-project 4 --messages-per-session 5
```

This outputs a markdown report with:
- Project count, session count, running process count
- Overview table (project / sessions / last active / running)
- Per-project detail: last 4 sessions with user message excerpts
- Running Claude processes mapped to directories

Capture the full output. This is your primary intelligence source — it tells you what the user was *actually asking about* across all projects.

### Scan 2: Active git repos (last 14 days)

```bash
for dir in ~/Documents/02_Dev/*/; do
  if [ -d "$dir/.git" ]; then
    last=$(git -C "$dir" log -1 --format="%ar|%s" 2>/dev/null)
    if [ -n "$last" ]; then
      count=$(git -C "$dir" log --oneline --since="14 days ago" 2>/dev/null | wc -l | tr -d ' ')
      if [ "$count" -gt 0 ]; then
        echo "ACTIVE|$(basename "$dir")|$count|$last"
      fi
    fi
  fi
done
```

### Scan 3: Key files from active projects

For each active project from Scans 1-2, look for:
```bash
find ~/Documents/02_Dev/<project> -maxdepth 2 \( -name "TODO*" -o -name "plan.md" -o -name "codify.md" -o -name "CLAUDE.md" \) -type f 2>/dev/null
```

Read:
- `CLAUDE.md`: First 15 lines (project identity)
- `plan.md` / `TODO*`: Full read
- `codify.md`: Last 20 lines (recent learnings)

### Scan 4: Previous review (for comparison)

```bash
ls -t ~/.claude/memory/reviews/*.md 2>/dev/null | head -2
```

Read the most recent review file (skip any file you're about to create). Note what changed since then.

### Write the review

Synthesize all scans into a single cohesive report. The session transcripts (Scan 1) tell you *what the user was working on*. The git data (Scan 2) tells you *what actually shipped*. The key files (Scan 3) tell you *what's planned*. The previous review (Scan 4) shows *trajectory*.

```markdown
# Situation Report — {YYYY-MM-DD}
> Scanned: {time} | {N} active projects | {M} sessions | {R} running processes

## Summary
2-3 sentence overview. What's hot, what's stalled, what needs attention.

## Active Projects

### {project_name} — {one-line status}
- **What's happening**: {synthesize from session messages + git commits}
- **Git**: {N} commits in 14 days, last: "{msg}" ({time ago})
- **Sessions**: {N} sessions, last active {time}. Recent topics: {from user messages}
- **Phase**: {from plan.md/CLAUDE.md}
- **Open items**: {from TODO/plan files}

### {next project...}

## Session Landscape
> {total projects} projects | {total sessions} sessions | {running} active processes

Highlight:
- Projects with many recent sessions (high activity)
- Projects with running processes (still open)
- Projects where session topics diverge from plan (potential drift)

## Open Items (All Projects)
- [ ] {project}: {task}
- [ ] {project}: {task}

## What Changed Since Last Review
- {comparison with previous review, if one exists}
- {new projects, completed items, stalled work}

## Running Processes
- {list running Claude instances and their directories}
- {flag stale processes that should be closed}

## Attention Needed
- {stalled projects, overdue items, cross-project conflicts}
- {sessions with no git commits (talk but no ship)}
- {running processes with no recent activity (zombies)}
```

**Rules:**
- Keep under 150 lines
- Be concise — this is a report, not a data dump
- Session messages are the richest signal — use them to understand intent
- Compare with previous review if one exists
- Categorize: active / stalled / new
- Flag anything stuck or contradictory
- Flag zombie processes (running but inactive)

---

## Step 2: Acknowledge

Tell the user: "Producing situation report in background. Will be saved to `~/.claude/memory/reviews/{date}_{time}.md`."

## Step 3: When Complete

Read the review file. Present it to the user.

Offer:
- "Want to dive into a specific project?"
- "Should I update any open items?"
- "Want to compare with previous reviews?"

## Arguments

- No args: Standard review, background mode
- `--deep`: Include stale projects (14+ days), read more files per project
- `--compare`: Read last 3 reviews and show trajectory / what changed
- `<project-name>`: Deep review of one specific project only
