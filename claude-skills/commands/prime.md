---
description: Gain a general understanding of the codebase
---

# Prime

Execute all sections to understand the codebase, recent activity, and session context.

## 1. Codebase Structure

### Run
```bash
git ls-files | head -100
```

### Read
- README.md
- CLAUDE.md (if exists)

## 2. Recent Activity (from session-history skill)

### Git Context
```bash
# Recent commits
git log --oneline --date=short --format="%h %ad %s" -10 2>/dev/null

# Uncommitted changes
git status --short

# Files changed in recent commits
git diff --stat HEAD~5 2>/dev/null | tail -20
```

### Recently Modified Files
```bash
# Files modified in last 24 hours (non-hidden, excluding node_modules)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' -mtime -1 2>/dev/null | head -20
```

## 3. Session History

### Recent Todos
```bash
# Find non-empty todo files, show most recent
TODO_FILE=$(find ~/.claude/todos -type f -size +2c 2>/dev/null | xargs ls -t 2>/dev/null | head -1)
if [ -n "$TODO_FILE" ]; then
  echo "Most recent todos:"
  cat "$TODO_FILE" | jq -r '.[] | "[\(.status)] \(.content)"' 2>/dev/null
fi
```

### Recent Plans
```bash
# Show most recent plan summary
PLAN_FILE=$(ls -t ~/.claude/plans/ 2>/dev/null | head -1)
if [ -n "$PLAN_FILE" ]; then
  echo "Most recent plan: $PLAN_FILE"
  head -25 ~/.claude/plans/"$PLAN_FILE"
fi
```

## 4. Report

Synthesize your understanding:

1. **Codebase**: What is this project? Tech stack? Structure?
2. **Recent Work**: What files were changed recently? Any uncommitted work?
3. **Session Context**: What was Claude working on? Any pending todos or active plans?
4. **Recommendations**: What should we focus on based on context?

---

## Quick Reference

| Need | Command |
|------|---------|
| Just codebase structure | `/prime` (section 1 only) |
| What was I doing? | `/history` |
| Full context | `/prime` (all sections) |
