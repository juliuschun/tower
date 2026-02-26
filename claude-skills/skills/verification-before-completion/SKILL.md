---
name: verification-before-completion
description: Use before claiming work is complete — run verification commands and confirm output before making success claims
---

# Verification Before Completion

## Overview

Run verification before claiming work is done. Evidence before assertions.

## The Gate

Before claiming any status:

1. **Identify** — what command proves this claim?
2. **Run** — execute the full command (fresh, complete)
3. **Read** — full output, check exit code, count failures
4. **Verify** — does output confirm the claim?
   - If no: state actual status with evidence
   - If yes: state claim with evidence
5. **Then** make the claim

## Common Verifications

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check |
| Build succeeds | Build command: exit 0 | Linter passing |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Requirements met | Line-by-line checklist | Tests passing alone |

## Key Patterns

**Tests:**
```
Good: [Run test command] [See: 34/34 pass] "All tests pass"
Bad:  "Should pass now" / "Looks correct"
```

**Build:**
```
Good: [Run build] [See: exit 0] "Build passes"
Bad:  "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
Good: Re-read plan -> checklist -> verify each -> report
Bad:  "Tests pass, phase complete"
```

## When To Apply

Before:
- Any success/completion claims
- Committing, PR creation, task completion
- Moving to next task
