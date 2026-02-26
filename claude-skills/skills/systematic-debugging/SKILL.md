---
name: systematic-debugging
description: Use when encountering a bug, test failure, or unexpected behavior — find root cause before attempting fixes
---

# Systematic Debugging

## Overview

Find root cause before attempting fixes. Random fixes waste time and create new bugs.

## When to Use

- Test failures, bugs, unexpected behavior
- Performance problems, build failures
- Integration issues
- Especially when "just one quick fix" seems obvious — that's when systematic approach pays off most

## The Four Phases

### Phase 1: Root Cause Investigation

Before attempting any fix:

1. **Read error messages carefully**
   - Full stack traces, line numbers, error codes
   - They often contain the exact solution

2. **Reproduce consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible, gather more data first

3. **Check recent changes**
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather evidence in multi-component systems**
   - Log what enters and exits each component boundary
   - Run once to see WHERE it breaks
   - Then investigate that specific component

5. **Trace data flow**
   - Where does the bad value originate?
   - Keep tracing upstream until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

1. **Find working examples** — locate similar working code in same codebase
2. **Compare against references** — read reference implementations completely
3. **Identify differences** — list every difference, however small
4. **Understand dependencies** — what components, settings, config does this need?

### Phase 3: Hypothesis and Testing

1. **Form single hypothesis** — "I think X is the root cause because Y"
2. **Test minimally** — smallest possible change, one variable at a time
3. **Verify** — worked? Move to Phase 4. Didn't work? New hypothesis.

### Phase 4: Implementation

1. **Create failing test case** — simplest possible reproduction
2. **Implement single fix** — address root cause, one change at a time
3. **Verify fix** — test passes? No other tests broken?
4. **If 3+ fixes have failed** — stop and question the architecture. This may indicate a deeper structural problem worth discussing.

## Supporting Techniques

Available in this directory:

- **`root-cause-tracing.md`** — trace bugs backward through call stack
- **`defense-in-depth.md`** — add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** — replace arbitrary timeouts with condition polling

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |
