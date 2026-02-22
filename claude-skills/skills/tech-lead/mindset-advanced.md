# Advanced Mental Habits (M8-M10)

**Purpose**: Specialized habits for execution monitoring, diagnostic reasoning, and naming alignment.

**Prerequisite**: Foundational habits M1-M7 from [Mindset Properties](mindset.md).

---

## Overview

| # | Habit | Catch Question |
|---|-------|----------------|
| **M8** | Execution awareness | "What evidence do I have vs an hour ago?" |
| **M9** | Diagnostic reasoning | "What's my hypothesis? What would confirm/refute it?" |
| **M10** | Mental model alignment | "Who reads this? What do they expect?" |

---

## M8: Execution Awareness

> Notice when effort diverges from progress; adapt or escalate before sunk cost compounds.

### The Trap

**Tunnel vision**. You are working hard, but the distance to the goal isn't shrinking. Flow state feels productive, but you may be drifting—grinding without advancing.

M6 combats **panic** (urgency → slow down). M8 combats **drift** (flow → check navigation).

### Catch Question

> "What new evidence do I have vs an hour ago? (test passing, repro confirmed, hypothesis ruled out, smaller diff)"

Alternative formulation:
> "If I stop now, is the system in a better state than an hour ago?"

**Progress = Evidence, not Feelings**. "I'm 90% done" is not evidence. A passing test, a ruled-out hypothesis, or a smaller diff is evidence.

### Execution Tripwires

Watch for these signals that indicate drift:

| Signal | Type | What It Means |
|--------|------|---------------|
| "One more try" (3rd+ attempt) | Sunk Cost | Adaptation needed; switch hypothesis |
| "I'll just clean this up while I'm here" | Scope Creep | Not in Outcome statement |
| "This is taking longer than expected" | Timebox Breach | Check evidence vs contract |
| "Almost there" (repeated) | Progress Illusion | Zeno's Paradox |
| "While I'm here, I noticed..." | Magpie | Scope creep disguise |
| "I just need to write a script to help debug" | Meta-work Trap | Tooling over progress |
| "I changed X, Y, Z hoping it fixes..." | Shotgun Debugging | Violated scientific method |
| "Let me refactor first so it's easier" | Scope Creep | Needs Outcome/Evidence link |
| "I'll investigate / dig into it" | Undefined Work | Needs timebox + deliverable |
| "Maybe it's X..." (new guess, repeated) | Unstructured Search | Switch to hypothesis-test loop |
| "I don't want to bother anyone" | Delayed Escalation | Add escalation threshold |
| "We've already changed a lot..." | Sunk Cost | Consider revert + smaller slice |

### Friction Signals (Execution)

- Same error recurring after 2+ attempts without new hypothesis
- Can't articulate what "done" looks like mid-task
- Working on something not in original Outcome statement
- Work queue grows instead of shrinks
- Can't demonstrate progress (no demo, no passing test, no ruled-out hypothesis)

### The 3rd Attempt Rule (Enhanced)

> "If I try to fix the same error 3 times without a new hypothesis, I am not debugging; I am guessing. Stop and Re-derive (M1)."

This is the execution counterpart to M1's epistemic hygiene. When this triggers, shift to M9 diagnostic reasoning:

| Trigger | Response |
|---------|----------|
| Same approach failing 3x | **Not** "try harder" → **Instead** "what have I ruled out?" |
| No hypotheses eliminated | You're changing variables, not testing hypotheses |
| Can't articulate what you learned | Evidence audit: Facts / Ruled Out / Still Unknown |

**The Re-Derive Prompt** (integrates M1 + M9):
> "Before I try anything else: What do I KNOW from evidence? What am I ASSUMING about the cause? What would CHANGE my hypothesis?"

**Strategy Pivot Options** (choose based on situation, not in order):
- **Widen scope**: Bug may not be where symptom appears (M2: trace end-to-end)
- **Narrow scope**: Bisect the system to isolate layer
- **Change modality**: If code inspection failed, try observability (logs, traces)
- **Escalate**: Share evidence summary, not just "it's not working"

**Escalation Quality Check**:
- Bad: "The API is broken, I've tried everything"
- Good: "The API returns 500. I've ruled out: database (queries return in <10ms), auth (token validates correctly). Still unknown: why the serializer throws. Evidence: [stack trace]"

### Integration with Other Habits

| Existing Component | How M8 Connects |
|-------------------|-----------------|
| Effectiveness Contract (Timebox) | M8 enforces the contract at runtime |
| P5 (Short Feedback Loops) | M8 is the "during" enforcement of feedback |
| M6 (Pace Switching) | M8 is the "calm drift" counterpart to M6's "urgent panic" |
| M1 (Epistemic Hygiene) | "Stop and Re-derive" when 3rd attempt rule triggers |
| M9 (Diagnostic Reasoning) | M8 detects when to debug; M9 teaches how |
| Escalation Protocol | Add: "If timebox exceeded without evidence, escalate" |

### Practice

At natural breakpoints (every 30-60 min), ask:
1. "What evidence do I have now that I didn't have an hour ago?"
2. "Am I still solving the original Outcome, or did I drift?"
3. "If the answer to #1 is 'none', should I escalate or change approach?"

---

## M9: Diagnostic Reasoning

> Treat debugging as hypothesis-testing, not trial-and-error.

### The Core Shift

**Without diagnostic reasoning**:
> "It's not working. Let me try changing X... still broken... maybe Y... still broken..."

**With diagnostic reasoning**:
> "The symptom is Z. If the cause were A, I'd expect to see W in the logs. Let me check... W is absent, so A is ruled out. What else could cause Z without W?"

### Catch Questions (Adaptive, Not Sequential)

Use these to calibrate your approach based on the situation:

| Catch Question | When It Applies | What It Unlocks |
|----------------|-----------------|-----------------|
| "Can I reproduce this reliably?" | First question always | If no → switch to observability strategy |
| "Where in the system does this symptom manifest?" | When symptom is clear | Narrows search space |
| "What would I expect to see if my hypothesis is correct?" | Before any diagnostic action | Falsifiable prediction |
| "What's the smallest change that would confirm/refute?" | Before making changes | Prevents shotgun debugging |
| "What have I ruled OUT, not just tried?" | When stuck | Evidence audit |

### The Hypothesis Discipline

The difference between debugging and guessing:

| Guessing | Debugging |
|----------|-----------|
| "Let me try X" | "I hypothesize X. If true, I expect Y. Testing..." |
| Multiple changes at once | One variable per test |
| "It didn't work, try something else" | "X is ruled out because Y was absent. New hypothesis..." |
| Feelings: "almost there" | Evidence: tests passing, hypotheses eliminated |

### Strategy Selection (Adaptive)

Different situations call for different approaches:

| Situation | Strategy | Why |
|-----------|----------|-----|
| Reproducible locally | Binary search (bisect the system) | Narrow exponentially |
| Production-only | Observability-first (logs, traces, metrics) | Can't modify running system |
| Intermittent | Pattern correlation (time, load, data characteristics) | Need statistical signal |
| Data corruption | Audit trail (when did bad data first appear?) | Find the source, not the symptom |
| Performance | Profiling (measure, don't guess) | Intuition about perf is often wrong |

### Diagnostic Tool Selection

| Symptom Type | Primary Tool | What to Look For |
|--------------|--------------|------------------|
| Request failures | Traces | Where did the call fail in the chain? |
| Slow responses | Profiler/APM | Which component adds latency? |
| Data corruption | Logs + Audit | When did bad data first appear? |
| Intermittent failures | Metrics | Pattern correlation with load/time |
| Memory issues | Heap dumps | Object retention, leak suspects |

### Integration with Existing Mindsets

| Mindset | Debugging Application |
|---------|----------------------|
| M1 (Epistemic hygiene) | Separate what you KNOW from what you're GUESSING about the bug |
| M2 (Systems thinking) | Trace the failure end-to-end; bugs rarely live where symptoms appear |
| M5 (Operational imagination) | "How will I debug this at 2am?" Design for diagnosability |
| M8 (Execution awareness) | The 3rd Attempt Rule: if retrying without new hypothesis, you're not debugging |

### The Evidence Audit

When M8's 3rd Attempt Rule triggers, run this:

> "What do I now KNOW that I didn't know when I started?"
> - Hypotheses confirmed: [list]
> - Hypotheses ruled out: [list]
> - New information discovered: [list]
> - Still unknown: [list]

If the "ruled out" list is empty after 3 attempts, you haven't been debugging—you've been guessing.

### Friction Signals (You're Doing It Wrong)

| Signal | What It Means |
|--------|---------------|
| "I changed 5 things and it still doesn't work" | Violated one-variable-at-a-time |
| "Let me just try this..." (no prediction stated) | Guessing, not hypothesizing |
| "I'm 90% sure it's X" but no test designed | Confidence without evidence |
| Same error after 3+ attempts | 3rd Attempt Rule triggered |
| Can't explain what you've ruled out | No evidence accumulation |

### Practice

When debugging:
1. **State your hypothesis** before touching code
2. **Predict what you expect to see** if the hypothesis is correct
3. **Test one variable** at a time
4. **Record the result**: Confirmed, ruled out, or inconclusive
5. **Update your hypothesis** based on evidence, not frustration

---

## M10: Mental Model Alignment

> Design names for the reader's understanding, not the writer's convenience.

### Catch Question

"Who reads this? What do they already know? What will they expect?"

### The Core Shift

**Without mental model alignment**:
> "I'll call it `processData` - that's what it does."

**With mental model alignment**:
> "Who reads this? New team members. They'll expect `processData` to transform data, but this validates and enriches. Better: `validateAndEnrichCustomerRecord`"

### The Expert Paradox

Novices need good names MORE than experts (who compensate with context).
But experts create bad names because they don't experience the confusion.

This is the "curse of knowledge" - once you know something, you can't un-know it. The name makes sense to you because you have the full context. Readers don't.

### Five Naming Strategies

| Strategy | Catch Question |
|----------|----------------|
| **Skip-Reading Test** | "Can I understand this WITHOUT reading the code?" |
| **Caller-Need Naming** | "What does the CALLER need, not how I provide it?" |
| **State-Transition Booleans** | "If this boolean is false, what HAPPENED?" |
| **Boundary-Definition** | "What would make someone HESITATE to add unrelated code?" |
| **Collision Awareness** | "What do we already call similar things?" |

### Naming Compounds (Expert Pattern)

| Novice | Expert |
|--------|--------|
| `data` | `customerOrderHistory` |
| `result` | `validationErrors` |
| `process()` | `calculateShippingCost()` |
| `handle()` | `routeIncomingWebhook()` |

### Friction Signals (Naming)

| Signal | What It Indicates |
|--------|-------------------|
| Name requires verbal explanation in PR | Self-documenting failed |
| "What does this do again?" (repeated) | Name doesn't convey meaning |
| IDE autocomplete confusion | Names not discriminable |

**For full naming strategies, see [naming.md](naming.md).**

---

## Language Tripwire Signals (Hidden Decisions)

These phrases indicate you may have made a decision without recognizing it:

| Signal | What It Means | Habit Triggered |
|--------|---------------|-----------------|
| "I'll just...", "quick fix..." | Commitment disguised as non-decision | M7 |
| "Temporary...", "for now...", "good enough..." | Technical debt without quantification | M7, M1 |
| "Put it here", "hardcode it" | Structure decision without analysis | M7, P6 |
| "Ignore this error", "catch and continue" | Failure policy decision | M7, P5 |
| "What's the correct practice for X?" | Meta-question hiding real decision | M7, P1 |

---

## Related Documents

- [Mindset Properties](mindset.md) - Foundational habits M1-M7
- [Effectiveness](effectiveness.md) - Applying M8 with Effectiveness Contract
- [Naming](naming.md) - Full M10 naming strategies
- [Escalation](escalation.md) - When M8 triggers asking for help
