---
name: executing-plans
description: Use when you have a written implementation plan to execute — batch execution with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute tasks in batches, report for review between batches.

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically — identify any questions or concerns
3. If concerns: raise them before starting
4. If no concerns: proceed

### Step 2: Execute Batch
**Default: first 3 tasks**

For each task:
1. Follow each step as specified
2. Run verifications as specified
3. Track progress

### Step 3: Report
When batch complete:
- Show what was implemented
- Show verification output
- Say: "Ready for feedback."

### Step 4: Continue
Based on feedback:
- Apply changes if needed
- Execute next batch
- Repeat until complete

### Step 5: Complete
After all tasks complete and verified:
- Summarize what was done
- Run final verification
- Present options: merge, PR, or further work

## When to Stop and Ask

- Hit a blocker mid-batch (missing dependency, test fails, instruction unclear)
- Plan has critical gaps
- You don't understand an instruction
- Verification fails repeatedly

Ask for clarification rather than guessing.

## Remember
- Review plan critically first
- Follow plan steps as specified
- Don't skip verifications
- Between batches: report and wait for feedback
- Stop when blocked, don't guess
- Avoid starting implementation on main/master branch without user consent
