# Effectiveness: The Meta-Principle

**Purpose**: Enable self-assessment of work quality without senior review.

**Key Insight**: The [7 Principles](principles.md) enforce *constraints*. Effectiveness sets *what "good" looks like*.

---

## Core Idea

Effectiveness is a meta-principle that governs HOW the 7 principles are applied:
- Principles tell you what to check
- Effectiveness tells you whether the checks are producing value

**Without effectiveness thinking**: "I followed the checklist."
**With effectiveness thinking**: "I produced an outcome that's measurably better."

---

## Effectiveness Contract

Before starting any significant task, fill out this contract (3-6 lines):

```
Outcome: [1 sentence - what changes in the world when this is done]
Evidence: [how we'll prove it worked]
Non-goals: [what we explicitly won't touch]
Risks: [what could go wrong]
Rollback: [how to undo if needed]
Timebox: [when to stop and reassess if blocked]
```

### Example: Adding Price Adjustment Feature

```
Outcome: Users can see stock prices adjusted for splits/dividends
Evidence: Test suite passes + manual verification of 3 known split events
Non-goals: Historical backfill (separate task), real-time updates (future)
Risks: Data source format changes, calculation precision errors
Rollback: Feature flag disabled, no schema changes
Timebox: 4 hours before checking in on approach
```

### Why This Matters

The contract:
1. **Prevents scope creep** - Non-goals are explicit
2. **Forces falsifiability** - Evidence is specified upfront
3. **Enables reversibility** - Rollback plan exists before starting
4. **Creates natural checkpoints** - Timebox prevents rabbit holes

---

## Effectiveness Questions

### Before (Set Direction)

| Question | Purpose |
|----------|---------|
| What *outcome* am I trying to change (1 sentence)? | Focus |
| What's the *evidence* I'll use to prove it worked? | Falsifiability |
| What's the *smallest acceptable change* that achieves the outcome? | Scope control |
| What are explicit *non-goals*? | Prevent drift |
| What's the *riskiest assumption* and fastest way to validate it? | P2 integration |

### During (Stay Efficient)

| Question | Purpose |
|----------|---------|
| Am I still solving the original outcome, or drifting? | Scope check |
| Is the diff still *reviewable*? Can I split it? | P7 integration |
| Did I create a *fast feedback loop* before building more? | P5 integration |
| What decision did I just make—did I write it down? | P7 integration |
| **What new evidence do I have vs an hour ago?** | M8 integration |

**Progress = Evidence, not Feelings**. Saying "I'm 90% done" is not evidence. Evidence is:
- A test that now passes (that didn't before)
- A hypothesis ruled out with data
- A smaller diff that's closer to complete
- A repro confirmed or narrowed

"Almost there" three times in a row means you're not tracking progress—you're tracking hope.

### After (Prove and Learn)

| Question | Purpose |
|----------|---------|
| Can a teammate understand "why + what + risk" in 5-10 min from the PR? | Knowledge transfer |
| Did I leave the system *easier* to change than before? | P4 integration |
| What would I do differently to get the same result faster/safer? | Learning |

---

## Observable Outcomes: Effective vs Just Completed

| Effective | Just Completed |
|-----------|----------------|
| Change is isolated, minimal surface area, easy to review | It builds; tests pass |
| PR states outcome, evidence, risk, rollout/rollback | PR says "fix bug" |
| Assumptions validated early with small experiment | Implemented full solution then hoped |
| Uses existing patterns; new abstraction only when it pays rent | Works but inconsistent/one-off |
| Failure modes handled (errors, edge cases, observability) | Happy path works |
| Change is safe to deploy (flagged, canaryable, reversible) | Merged directly; rollback unclear |

### Self-Assessment Rubric

After each task, rate yourself:

| Dimension | 1 (Weak) | 3 (Adequate) | 5 (Strong) |
|-----------|----------|--------------|------------|
| **Outcome clarity** | Vague goal | Clear goal | Measurable success criteria |
| **Scope discipline** | Scope crept | Mostly on target | Exactly what was needed |
| **Evidence quality** | "It works" | Tests pass | Edge cases + observability |
| **Reversibility** | No rollback plan | Can revert | Feature flag + migration |
| **Pattern consistency** | New pattern without checking | Checked, minor deviation | Followed existing exactly |
| **Decision documentation** | None | In PR description | ADR if warranted |

---

## Self-Feedback Cycle

Since you often work without senior review, you need to be your own reviewer.

### During Work: Effectiveness Checkpoints

At natural breakpoints (every 30-60 min of focused work), ask:
1. "Am I still within outcome + non-goals?"
2. "Is the next step the smallest one that increases evidence?"
3. "What decision did I just make that I should document?"

### After Work: 2-Minute Retro

Immediately after completing a task:
1. "One thing that made this effective" → Keep doing
2. "One thing to change next time" → Concrete improvement

Save these as reusable playbook items.

### Weekly Review (10 min)

At the end of the week:
1. Review your 2-minute retros
2. Look for patterns in "things to change"
3. Pick ONE habit to focus on next week

---

## Execution Monitoring (Applying M8)

The Effectiveness Contract is powerful at planning time, but drift happens during execution. [M8: Execution Awareness](mindset-advanced.md#m8-execution-awareness) bridges the contract to runtime.

**Key Insight**: mindset.md *defines* M8 (what the habit is). This section *applies* M8 (how to use it with the Effectiveness Contract).

### Checkpoint Integration

At each 30-60 minute checkpoint, apply M8's catch question to your Effectiveness Contract:

| Contract Field | M8 Check |
|----------------|----------|
| **Outcome** | "Am I still solving this, or did I drift?" |
| **Evidence** | "What new evidence do I have vs an hour ago?" |
| **Non-goals** | "Did I touch something I said I wouldn't?" |
| **Timebox** | "Have I exceeded this? If so, what's my evidence?" |

### Evidence Types (What Counts as Progress)

Not all work produces visible "closer to done" progress. Some work is legitimately exploratory:

| Work Type | Valid Evidence | Not Evidence |
|-----------|----------------|--------------|
| **Feature work** | Test passing, diff smaller | "Almost there" |
| **Spike** | Hypotheses tested, risks identified | "Still exploring" |
| **Investigation** | Root cause narrowed, causes ruled out | "Still looking" |
| **Research** | Options mapped with trade-offs | "Gathering info" |

**Rule**: If you can't articulate what you learned, you haven't made progress.

### When M8 Triggers Escalation

Per [escalation.md](escalation.md), escalate when:
- Timebox exceeded AND no new evidence
- 3rd Attempt Rule triggered AND can't articulate what you ruled out
- Evidence audit shows "ruled out" list is empty

See [mindset-advanced.md](mindset-advanced.md#m8-execution-awareness) for M8 definition and [M9: Diagnostic Reasoning](mindset-advanced.md#m9-diagnostic-reasoning) for systematic debugging methodology.

---

## Decision Surfacing Effectiveness

Effective decision surfacing means catching hidden decisions before they become commitments.

### Self-Assessment Checklist

| Dimension | Question | Effective Sign |
|-----------|----------|----------------|
| **Tripwire detection** | Did I scan for language cues before acting? | Caught "I'll just..." before committing |
| **Decision recognition** | Did I notice when I was making a decision? | Named the decision explicitly |
| **Requirements derivation** | Did I identify what must be true? | Listed 2-3 decision requirements |
| **Reversibility assessment** | Did I check if this is reversible? | Know the rollback path |
| **Precedent awareness** | Did I consider if this will be copied? | Flagged pattern-setting decisions |

### Decision Surfacing Loop Compliance

After each work session, check:

1. **Tripwire scanning**: Did I check messages/plans for language tripwires?
2. **Decision-ness filter**: Did I apply the 2+ rule before escalating?
3. **Callout output**: Did I surface hidden decisions with the callout template?
4. **Requirements capture**: Did I document decision requirements for significant decisions?

### Observable Outcomes: Good vs Poor Decision Surfacing

| Good Decision Surfacing | Poor Decision Surfacing |
|-------------------------|------------------------|
| Hidden decision named before committing | Realized decision after shipping |
| Decision requirements documented | "It seemed right at the time" |
| Reversibility known before acting | Discovered it's hard to undo |
| Tripwires caught proactively | Only recognized decision in retrospect |
| Context-aware questions asked | Generic "best practice" questions |

---

## Integration with Principles

The Effectiveness Contract integrates all 7 principles:

| Contract Field | Principle Connection |
|----------------|---------------------|
| Outcome | P1: Define the job |
| Evidence | P5: Truthful feedback loops |
| Non-goals | P1: Define the edges |
| Risks | P2: Uncertainty as real work |
| Rollback | P4: Reversibility |
| Timebox | P5: Short feedback loops |

---

## AI Agent Integration

Use AI as an effectiveness coach. Prompt template:

```
Act as my effectiveness coach. Before I start coding:

1. Make me fill out this contract:
   - Outcome (1 sentence)
   - Evidence (how we prove it worked)
   - Non-goals (what we won't touch)
   - Risks (what could go wrong)
   - Rollback (how to undo)
   - Timebox (when to reassess)

2. During work, whenever I propose a change, ask:
   "Is this the smallest step that increases evidence?"

3. After, grade my effectiveness:
   - Did I stay within outcome + non-goals?
   - Did I create evidence before building more?
   - Did I document decisions?

4. Propose 1 concrete process tweak for next time.
```

---

## Example: Effective vs Ineffective Approach

### Scenario: Add validation to user input form

**Ineffective approach**:
1. Start coding validation logic
2. Add more validation as edge cases appear
3. Refactor form component to support validation
4. Add error display
5. "Done" when it seems to work

**Effective approach**:

**Before**:
```
Outcome: Form rejects invalid input and shows helpful error messages
Evidence: Test cases for 5 known invalid inputs, error messages are actionable
Non-goals: Custom validation rules (use standard), accessibility improvements
Risks: Breaking existing form flow, missing edge cases
Rollback: Validation is additive, can be removed
Timebox: 2 hours before checking if approach is sound
```

**During**:
- Checkpoint at 1 hour: "Still solving validation, not drifting into form redesign"
- Decision documented: "Using Zod for schema validation—matches other forms in codebase"

**After**:
- Self-assessment: Scope 5/5, Evidence 4/5 (could add one more edge case)
- Retro: "Checking non-goals at hourly checkpoints kept me focused"
- Learning: "Define test cases BEFORE writing validation logic next time"

---

## Root Cause Analysis (Post-Fix)

After resolving an issue, capture learning to prevent recurrence. This is the post-fix complement to M9's diagnostic reasoning.

### The Three Causes

Every significant bug has multiple levels of cause:

| Level | Question | Example |
|-------|----------|---------|
| **Immediate cause** | What directly triggered failure? | Null pointer exception in serializer |
| **Enabling cause** | Why was that possible? | No validation on input from external API |
| **Root cause** | What systemic issue allowed this? | No contract between services about nullable fields |

**Key Insight**: Fixing only the immediate cause leaves the enabling and root causes in place. The bug will recur in a different form.

### The "5 Whys" with Expert Refinement

The classic "5 Whys" technique works, but requires discipline:

1. **Ask "why" but distinguish symptom from cause**
   - Symptom: "The page crashed"
   - Cause: "Unhandled null in render function"

2. **Stop when you reach something you can PREVENT, not just fix**
   - Bad stopping point: "The API returned null" (can't control external API)
   - Good stopping point: "We have no validation layer for external data" (can fix)

3. **Convert to actionable improvement**
   - Test: "Add test that fails if external API returns null"
   - Alert: "Monitor for null responses from external API"
   - Design change: "Add validation layer at integration boundary"

### Learning Capture (2-Minute Template)

After resolving any non-trivial bug:

```
Bug: [1-sentence description]
Immediate fix: [What you changed]
Enabling cause: [Why this was possible]
Prevention: [Test/alert/design change to prevent class of bug]
```

### Integration with Learning Loop

This RCA feeds into the Learning Loop from [SKILL.md](SKILL.md):
- Pattern identification: "Is this a new failure mode or a known one?"
- Script compilation: "If [symptom], check [this class of cause] first"
- Gradual automation: "Can we lint/test/alert for this automatically?"

---

## Related Documents

- [Principles](principles.md) - Constraints that effectiveness applies
- [Mindset](mindset.md) - Foundational mental habits (M1-M7)
- [Advanced Mindsets](mindset-advanced.md) - M8 execution awareness, M9 diagnostic reasoning, M10 naming
- [Speculation Protocol](speculation.md) - When to slow down and understand deeply
- [Escalation](escalation.md) - When to ask for help (triggered by M8)
