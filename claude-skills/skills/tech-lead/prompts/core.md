# Core Principle-Based Prompts

**Purpose**: Consolidated prompts derived from the 7 principles.

**Usage**: These prompts are the "activation triggers" for principles. Use them at natural decision points, not as a checklist to run through mechanically.

---

## The 7 Principle Prompts

### P1: Define the Job

> "What's success? What are the non-goals?"

**Use when**: Starting any task, clarifying requirements, scoping work

**Deeper questions**:
- "What outcome am I trying to change (1 sentence)?"
- "What will I explicitly NOT touch?"
- "What are the current and future usage patterns?"

**Hidden decision surfaced**: Where does this module live? ([CASE-RESOLVER](../cases.md#case-resolver-proposals-without-understanding))

---

### P2: Treat Uncertainty

> "What's the riskiest assumption and fastest way to validate it?"

**Use when**: Accepting workarounds, using temporary solutions, making estimates

**Deeper questions**:
- "What don't we know that could sink us?"
- "What's the failure probability at current scale? At 10x?"
- "If this assumption is wrong, what breaks?"

**Hidden decision surfaced**: What failure rate are we accepting? ([CASE-ID](../cases.md#case-id-temporary-without-quantification))

---

### P3: Make Meaning Explicit

> "What must always be true? Who owns this?"

**Use when**: Working with data, defining contracts, building shared components

**Deeper questions**:
- "Is this idempotent? Can it be safely retried?"
- "What's the transaction boundary?"
- "Where is the source of truth?"

**Hidden decision surfaced**: What contracts are we committing to?

---

### P4: Isolate Volatility

> "If we change [X], is this still true? What's the blast radius?"

**Use when**: Naming things, choosing abstractions, making architectural decisions

**Deeper questions**:
- "If we change backend, is this name still accurate?"
- "What's reversible here? What's irreversible?"
- "Am I creating or consuming options?"

**Hidden decision surfaced**: What abstraction boundary are we creating? ([CASE-NAMING](../cases.md#case-naming-implementation-detail-in-names))

---

### P5: Short Feedback Loops

> "How will we know it's broken? What triggers action?"

**Use when**: Deploying, monitoring, creating alerts, defining success criteria

**Deeper questions**:
- "At 2am, how do we know this failed?"
- "What specific signal triggers investigation?"
- "How long until we notice a problem?"

**Hidden decision surfaced**: What failure detection contract are we accepting?

---

### P6: Consistency

> "Where does similar live? Do we already do this?"

**Use when**: Creating new modules, introducing patterns, structuring code

**Deeper questions**:
- "What's the existing convention for this?"
- "If I copy this pattern, what else copies it?"
- "Why would I deviate from existing practice?"

**Hidden decision surfaced**: What directory structure contract are we setting? ([CASE-STRUCTURE](../cases.md#case-structure-module-in-wrong-location))

---

### P7: Document Decisions

> "Context → Options → Decision → Why"

**Use when**: Making architectural choices, choosing between approaches, finalizing design

**Deeper questions**:
- "6 months from now, will someone understand why?"
- "What would change my mind about this decision?"
- "What did I NOT choose and why?"

**Hidden decision surfaced**: What trade-offs are we committing to?

---

## Decision Surfacing Prompts

### Decision Callout Template

When a hidden decision is detected, output this:

```
**Hidden Decision Detected**: [What we're deciding]

**Why it matters**:
- [Stake 1]
- [Stake 2]

**Decision Requirements** (what must be true):
- [Requirement 1]
- [Requirement 2]

**Questions that would change the choice**:
1. [Question 1]
2. [Question 2]

**Safe default if proceeding now**: [reversible option + rollback hook]
```

### Tripwire Scanning Prompts

**Before each action, scan for**:

| Tripwire | Prompt |
|----------|--------|
| "I'll just...", "quick fix...", "for now..." | "What am I committing to without full analysis?" |
| "Temporary...", "good enough..." | "What risk am I accepting? What's the deadline?" |
| "Put it here", "hardcode it" | "Is this a structure/location decision?" |
| "Ignore this error" | "What failure policy am I choosing?" |
| "What's the correct practice for X?" | "What's the actual decision I'm trying to make?" |

### Decision-ness Filter (2+ Rule)

Only escalate when **2+ of these** apply:
- Hard to undo in <30 min
- Affects multiple modules/teams/users
- Changes invariants, ownership, or failure behavior
- Likely to be copied as "new standard"
- Can cause silent corruption/security/compliance pain
- Takes >30 min to figure out "why" later

---

## Situation-Specific Prompt Combinations

### New Module/Directory

1. P6: "Where does similar live?"
2. P1: "What's the scope? What's NOT in scope?"
3. P7: "Should I document this structural decision?"

### Workaround/Temporary Solution

1. P2: "What's the failure probability? Blast radius?"
2. P3: "What invariants might break?"
3. P5: "How will we know if this goes wrong?"

### Naming Decision

> "Who reads this? What do they know? What will they expect?"

**Three-Stage Check**:
1. **WHO**: What's the reader's mental model? (M10)
2. **WHAT**: Does name survive implementation changes? (P4)
3. **WHERE**: What do similar things call this? (P6)

**Strategy by Artifact Type**:

| Artifact | Primary Strategy | Catch Question |
|----------|-----------------|----------------|
| API/Config | Caller-Need Naming | "What does caller need, not how I provide it?" |
| Data Field | State-Transition | "If this boolean is false, what HAPPENED?" |
| Module | Boundary-Definition | "What would make someone HESITATE to add unrelated code?" |

**Tripwire Language**:
- "I'll just call it..." → Naming without deliberation
- "...Helper/Manager/Utils" → Responsibility unclear
- "Same as the library calls it" → External vocabulary leak

See [naming.md](../naming.md) for full strategies and examples.

### Migration/Fallback

1. P1: "What's success for this migration?"
2. P4: "What's reversible? What commits us?"
3. P5: "How do we know migration is complete?"

### Under Time Pressure

1. **PAUSE** (30 seconds)
2. "Should I step back first?"
3. P4: "Is this reversible? Can I fix it later?"
4. P2: "What's the riskiest thing I might miss?"

---

## Diagnostic Reasoning Prompts (M9)

When debugging or troubleshooting:

### Hypothesis Formation

> "I hypothesize [X]. If true, I expect to see [Y]. Testing..."

**Use when**: Before making any diagnostic change

### Evidence Audit

> "What do I now KNOW that I didn't know when I started?"
> - Hypotheses confirmed: [list]
> - Hypotheses ruled out: [list]
> - Still unknown: [list]

**Use when**: M8's 3rd Attempt Rule triggers (same error 3+ times)

### Strategy Selection

| Situation | Ask |
|-----------|-----|
| Reproducible locally | "Where in the system can I bisect to narrow exponentially?" |
| Production-only | "What observability (logs, traces, metrics) can I use?" |
| Intermittent | "What patterns correlate with failure (time, load, data)?" |
| Performance | "What does the profiler show? (Don't guess, measure)" |

See [mindset-advanced.md M9](../mindset-advanced.md#m9-diagnostic-reasoning) for full details.

---

## Friction Signal Prompts

When you notice these signals, STOP and ask:

| Friction Signal | Prompt |
|-----------------|--------|
| Can't explain solution simply | "What's my mental model? Is it wrong?" |
| Debating structure | "Are responsibilities clear? (P1, P3)" |
| Special cases proliferating | "Is the abstraction wrong? (P4)" |
| Testing feels unnatural | "Is there hidden state or coupling? (P3)" |
| Lots of glue code | "Does the model match reality? (P6)" |
| Can't state failure semantics | "What's the contract? (P3, P5)" |

---

## Effectiveness Contract Prompt

Before starting significant work:

```
Fill out before coding:
1. Outcome (1 sentence): ___
2. Evidence (how we prove it): ___
3. Non-goals (what we skip): ___
4. Risks (what could go wrong): ___
5. Rollback (how to undo): ___
6. Timebox (when to reassess): ___
```

---

## Speculation Mode Prompts

### Question Generator (Mode A)

```
Given [component + constraints], list the top 20 questions whose answers
would change the design. Group by: usage, data, ops, security, scaling,
milestones.
```

### Red Team (Mode B)

```
Assume this design is wrong. Generate:
- 15 failure modes (how could this break?)
- 10 future requirements that would break it
Rank by likelihood × impact.
```

### Concept Map (Mode C)

```
Draft a concept map showing [entities, boundaries, owners, flows].
Include: who calls what, who owns what, where state lives.
```

### Decision Matrix (Mode D)

```
Compare options [A, B, C] against criteria [list].
For each: what's the switching condition that would change the choice?
```

---

## Quick Reference Card

| When | Ask |
|------|-----|
| Starting task | "What's success? Non-goals?" (P1) |
| New structure | "Where does similar live?" (P6) |
| Workaround | "Failure probability? Blast radius?" (P2) |
| Naming | "Who reads this? What do they expect?" (M10) |
| Deploying | "How do we know it's broken?" (P5) |
| Data/contracts | "What must always be true?" (P3) |
| Finishing | "Context → Options → Decision → Why" (P7) |
| Under pressure | "Should I step back first?" (M6) |
| Seeing friction | "What's the underlying issue?" |
| Debugging | "What's my hypothesis? What would confirm/refute it?" (M9) |
| Stuck on same error | "What have I ruled OUT, not just tried?" (M9) |

---

## Related Documents

- [principles.md](../principles.md) - Full principle descriptions with worked examples
- [mindset.md](../mindset.md) - Foundational habits M1-M7 and friction signals
- [mindset-advanced.md](../mindset-advanced.md) - Advanced habits M8-M10 (execution, debugging, naming)
- [naming.md](../naming.md) - Expert naming strategies
- [effectiveness.md](../effectiveness.md) - Effectiveness Contract details
- [speculation.md](../speculation.md) - AI-assisted speculation modes
