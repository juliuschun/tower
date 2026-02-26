---
name: ready
description: Use this skill when the user asks "what was I working on", "show past sessions", "recent todos", "/ready", "resume", or wants to understand the project and see what they were working on.
version: 1.7.0
---

# Ready

Complete "resume work" skill for Claude Code. Shows project context, git activity, session history, and related files for the current project folder.

## Execution Flow

```
1. Project Context
   ├── README.md summary
   ├── CLAUDE.md (if exists)
   └── Codebase structure (git ls-files)

2. Git Activity
   ├── Uncommitted changes (git status)
   ├── Recent commits (last 10)
   └── Files changed recently

3. Session Timeline (interactive)
   ├── Haiku reads CONVERSATION ONLY (no tool calls) from last 10 sessions
   ├── Summarizes major points + identifies related sessions
   ├── Ask: Which session (or related group) to continue?
   ├── Retrieve conversation + file change counts (lean context)
   └── Haiku summarizes: goal, actions, decisions, next steps

4. Related Files (interactive)
   ├── Extract files from session tool_use (Read/Edit/Write)
   ├── Rank by frequency and action type
   ├── Ask: Which files to read?
   └── Display selected files

5. Synthesis Report
   └── "Here's where you left off..."
```

---

## Step 1: Project Context

### Read Project Files
```bash
# Check for README and CLAUDE.md
ls -la README.md CLAUDE.md 2>/dev/null
```

Read and summarize:
- **README.md** - What is this project? Tech stack?
- **CLAUDE.md** - Any special instructions for Claude?

### Codebase Structure
```bash
# Quick overview of project structure
git ls-files 2>/dev/null | head -50

# Or if not a git repo
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/dist/*' | head -50
```

Present a brief summary:
```
## Project: <name from README or folder>
**Tech Stack:** React, TypeScript, Vite (inferred from files)
**Structure:** src/, components/, utils/, tests/
```

---

## Step 2: Git Activity

### Uncommitted Changes
```bash
git status --short 2>/dev/null
```

### Recent Commits
```bash
git log --oneline --date=short --format="%h %ad %s" -10 2>/dev/null
```

### Files Changed Recently
```bash
git diff --stat HEAD~5 2>/dev/null | tail -15
```

### Recently Modified Files (last 24h)
```bash
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/dist/*' -mtime -1 2>/dev/null | head -15
```

Present:
```
## Git Activity

**Uncommitted Changes:**
M  src/App.tsx
A  components/NewFeature.tsx

**Recent Commits:**
- abc123 2024-01-26 Add session history skill
- def456 2024-01-26 Fix conversation parser
```

---

## Step 3: Session History (Interactive)

### 3.1 Summarize Recent Sessions with Haiku Subagent

Use the **Task tool** with `subagent_type: "haiku"` and `model: "haiku"` to efficiently read and summarize the last 10 sessions. The subagent should:

1. Get the list of session IDs:
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED_PATH"

# Get last 10 session IDs
cat "$PROJECT_DIR/sessions-index.json" 2>/dev/null | jq -r '
  .entries | sort_by(.modified) | reverse | .[:10][] |
  "\(.sessionId) | \(.summary // "Untitled") | \(.messageCount) msgs | \(.modified | split("T")[0])"
'
```

2. For each session, extract **last 200 conversation lines only** (capped to avoid token limits):
```bash
SESSION_ID="<session-id>"
# Extract ONLY text messages, LAST 200 lines (user prompts + Claude responses)
# Skip tool_use blocks, cap length to stay under token limits
cat "$PROJECT_DIR/$SESSION_ID.jsonl" | jq -r '
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    if (.message.content | type) == "string" then
      "👤 " + (.message.content | gsub("\n"; " ") | .[0:100])
    elif (.message.content | type) == "array" then
      (.message.content[] | select(.type == "text") | "👤 " + (.text | gsub("\n"; " ") | .[0:100]))
    else empty end
  elif .type == "assistant" then
    (.message.content[]? | select(.type == "text") | "🤖 " + (.text | gsub("\n"; " ") | .[0:150]))
  else empty end
' 2>/dev/null | grep -v "^$" | tail -200
```

**Why capped at 200 lines?**
- Prevents token overflow (some sessions are 25k+ tokens)
- Last 200 lines captures where you left off
- Shorter truncation (100/150 chars) keeps it lean

3. Present a summary table with the **last message** from each session:

```
## Recent Sessions (Last 10)

| # | Session | Last Activity | Where You Left Off |
|---|---------|---------------|-------------------|
| 1 | Toss Payment Integration | 2h ago | 👤 "should we test or find bugs with subagents?" |
| 2 | Heavy Mode Refactor | 1d ago | 🤖 "All fixes applied. Ready for testing." |
| 3 | API Rate Limiting | 2d ago | 👤 "deploy to prod when ready" |
| 4 | UI Polish | 3d ago | 🤖 "Dark mode toggle is working." |
| 5 | Database Migration | 4d ago | 👤 "looks good, let's move on" |
...
```

**Haiku Subagent Prompt:**
```
Read the last 10 sessions for this project. For each session:
1. Read ALL conversation turns (not just last 5)
2. Summarize the MAJOR POINTS of what was done (key decisions, features built, bugs fixed)
3. Identify the final message (where they left off)
4. Look for RELATED sessions that should be reviewed together

Present:

## Session Summaries

### [1] Toss Payment Integration (2h ago)
**What was done:**
- Integrated Toss payment API
- Fixed SSR issue with sessionStorage
- Added payment status endpoint

**Left off at:** 👤 "should we test or find bugs with subagents?"

### [2] Heavy Mode Refactor (1d ago)
**What was done:**
- Simplified 3-phase to 2-phase architecture
- Removed adaptive round logic
- Cleaned up dead code

**Left off at:** 🤖 "All fixes applied. Ready for testing."

---

## Related Sessions (Review Together)
Sessions 1, 2, 5 all relate to **payment integration** - recommend reviewing together for full context.
Sessions 3, 7 both involve **API changes** - may have dependencies.

This helps the user understand the full story, not just where they stopped.
```

### 3.2 Ask Which Session

After showing the summaries, ask the user which session(s) to explore:

```
Question: "Which session would you like to continue?"
Header: "Session"
Options (based on haiku analysis):
  - "[1] Toss Payment" (description: "Integrated API, fixed SSR, left at testing question")
  - "[2] Heavy Mode" (description: "Refactored to 2-phase, cleaned dead code, ready to test")
  - "Related: 1,2,5" (description: "Review all payment-related sessions together")
  - "Skip" (description: proceed with synthesis only)
```

**Note:** If haiku identifies related sessions, offer to load them together for full context.

### 3.3 Retrieve Session Conversation + File Summary

For the selected session, retrieve two things:

**A. Conversation text** (for haiku to summarize, capped at 200 lines):
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED_PATH"
SESSION_ID="<selected-session-id>"

# Last 50 conversation turns only - prevents token overflow
cat "$PROJECT_DIR/$SESSION_ID.jsonl" | jq -r '
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    if (.message.content | type) == "string" then
      "👤 " + (.message.content | gsub("\n"; " ") | .[0:100])
    elif (.message.content | type) == "array" then
      (.message.content[] | select(.type == "text") | "👤 " + (.text | gsub("\n"; " ") | .[0:100]))
    else empty end
  elif .type == "assistant" then
    (.message.content[]? | select(.type == "text") | "🤖 " + (.text | gsub("\n"; " ") | .[0:150]))
  else empty end
' 2>/dev/null | grep -v "^$" | tail -200
```

**B. Files changed** (simple count, no haiku needed):
```bash
# Just count edits/writes per file
cat "$PROJECT_DIR/$SESSION_ID.jsonl" | jq -r '
  select(.type == "assistant") |
  .message.content[]? |
  select(.type == "tool_use") |
  select(.name == "Edit" or .name == "Write") |
  .input.file_path | split("/") | .[-1]
' 2>/dev/null | sort | uniq -c | sort -rn | head -10
```

Then use **haiku** to summarize the conversation:

**Haiku Summary Prompt:**
```
Given this conversation (user/assistant messages only), summarize:
1. What was the USER trying to accomplish?
2. What did CLAUDE do to help?
3. What DECISIONS were made?
4. What's the CURRENT STATE? (done, blocked, in progress)
5. What should happen NEXT?

Be concise - 3-5 bullet points max.
```

Present as:
```
## Session: Toss Payment Integration

### Major Points
- Integrated Toss payment API with test credentials
- Fixed SSR issue: sessionStorage not available server-side
- Created payment status endpoint
- Discovered: Toss returns `orderNo` not `payToken`

### Files Changed
- payment.complete.tsx (6 edits)
- payment.py (4 edits)
- pricing.tsx (3 edits)

### Left Off At
👤 "should we test or find bugs with subagents?"

### Suggested Next Steps
1. Run E2E payment flow test
2. Or launch bug-finding subagents first
```

This gives the user the **full story** without drowning in raw timeline events.

---

## Step 4: Related Files (Interactive)

After showing the conversation, extract and offer to read files that were worked on.

### 4.1 Extract Files from Session
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED_PATH"
SESSION_ID="<from-step-3>"  # Use the session ID selected earlier

# Extract files with action counts, exclude ~/.claude/ paths
cat "$PROJECT_DIR/$SESSION_ID.jsonl" | jq -r '
  select(.type == "assistant") |
  .message.content[]? |
  select(.type == "tool_use") |
  select(.name == "Read" or .name == "Edit" or .name == "Write") |
  "\(.name) \(.input.file_path)"
' 2>/dev/null | grep -v "\.claude/" | sort | uniq -c | sort -rn | head -10
```

### 4.2 Present Files List

Show files ranked by activity:
```
## Files Worked On

| # | File | Activity |
|---|------|----------|
| 1 | src/components/AgentTimeline.tsx | 3 writes, 2 edits |
| 2 | src/App.tsx | 3 writes, 2 reads |
| 3 | src/types/agent.ts | 2 writes |
| 4 | src/data/mockAgents.ts | 2 writes |
```

### 4.3 Ask Which Files to Read

Use **AskUserQuestion** tool:
```
Question: "Which files would you like to read?"
Header: "Files"
multiSelect: true
Options:
  - "AgentTimeline.tsx (Recommended)" (description: most activity - 3 writes, 2 edits)
  - "App.tsx" (description: 3 writes, 2 reads)
  - "agent.ts" (description: 2 writes)
  - "Skip" (description: don't read any files)
```

### 4.4 Read Selected Files

For each selected file, use the **Read** tool to display its current contents.

Present as:
```markdown
## File: src/components/AgentTimeline.tsx

<file contents here>
```

---

## Step 5: Synthesis Report

After gathering all context, synthesize:

```markdown
## Summary: Where You Left Off

### Project
<Brief description from README>

### Recent Work
- <What files were changed based on git status/commits>
- <Any uncommitted work>

### Last Session: <session summary>
- <Key topics from conversation>
- <Any pending tasks from todos>

### Recommended Next Steps
1. <Based on uncommitted changes or in_progress todos>
2. <Based on conversation context>
```

---

## Data Sources

| Source | Location |
|--------|----------|
| Project files | `README.md`, `CLAUDE.md` |
| Codebase | `git ls-files` |
| Git activity | `git status`, `git log`, `git diff` |
| Sessions | `~/.claude/projects/<encoded-path>/sessions-index.json` |
| Transcripts | `~/.claude/projects/<encoded-path>/<session-id>.jsonl` |
| Todos | `~/.claude/todos/<session-id>-*.json` |
| Related files | Extracted from `tool_use` in session transcripts |
| CLI commands | Extracted from `Bash` tool_use in session transcripts |
| Code changes | Extracted from `Edit`/`Write` tool_use in session transcripts |

---

## Timeline Parser

The timeline shows an **interleaved chronological view** of the session, displaying events in the order they actually happened.

**Includes** (in chronological order):
- `👤` User messages (truncated to 100 chars)
- `🤖` Claude responses (truncated to 120 chars)
- `⚡` Bash commands executed (truncated to 80 chars)
- `📝` File edits (filename only)
- `📄` File writes/creates (filename only)

**Filters out** (noise):
- `tool_result` - Tool outputs/returns (we show the command, not the output)
- `thinking` - Extended thinking blocks
- System messages
- Read operations (just exploration, not changes)
- Exploratory tools (Glob, Grep, etc.)

---

## Quick Reference Commands

### List Sessions
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
cat "$HOME/.claude/projects/$ENCODED_PATH/sessions-index.json" | jq -r '
  .entries | sort_by(.modified) | reverse | .[:10][] |
  "\(.summary) | \(.messageCount) msgs | \(.modified | split("T")[0])"
'
```

### Project Todos
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED_PATH"
for sid in $(cat "$PROJECT_DIR/sessions-index.json" | jq -r '.entries[].sessionId'); do
  TODO="$HOME/.claude/todos/${sid}-agent-${sid}.json"
  [ -s "$TODO" ] && [ $(wc -c < "$TODO") -gt 2 ] && echo "=== $sid ===" && cat "$TODO" | jq -r '.[] | "[\(.status)] \(.content)"'
done
```

### Session Timeline (Interleaved)
```bash
ENCODED_PATH=$(pwd | sed 's|/|-|g; s|_|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED_PATH"
SESSION_ID="<session-id>"
cat "$PROJECT_DIR/$SESSION_ID.jsonl" | jq -r '
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    if (.message.content | type) == "string" then
      "👤 " + (.message.content | gsub("\n"; " ") | .[0:100])
    elif (.message.content | type) == "array" then
      (.message.content[] | select(.type == "text") | "👤 " + (.text | gsub("\n"; " ") | .[0:100]))
    else empty end
  elif .type == "assistant" then
    (.message.content[]? |
      if .type == "text" then
        "🤖 " + (.text | gsub("\n"; " ") | .[0:120])
      elif .type == "tool_use" then
        if .name == "Bash" then
          "⚡ $ " + (.input.command | gsub("\n"; " ") | .[0:80])
        elif .name == "Edit" then
          "📝 Edit: " + (.input.file_path | split("/") | .[-1])
        elif .name == "Write" then
          "📄 Write: " + (.input.file_path | split("/") | .[-1])
        else empty end
      else empty end)
  else empty end
' | grep -v "^$" | tail -40
```

---

## Implementation Notes

### Project Path Encoding
- Claude encodes paths by replacing `/` AND `_` with `-`
- Example: `/Users/foo/01_bar` → `-Users-foo-01-bar`
- Project data: `~/.claude/projects/<encoded-path>/`

### Session Data
- `sessions-index.json`: Metadata (summary, timestamps, message count)
- `<session-id>.jsonl`: Full transcript
- Todo files: `<session-id>-agent-<session-id>.json`

### Non-Git Repos
- Git commands may fail - handle gracefully
- Fall back to `find` for file structure
- Skip git activity section if not a repo
