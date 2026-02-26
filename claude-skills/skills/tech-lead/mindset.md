# Mindset Properties (Expert Mental Habits)

**Purpose**: Internal mental habits that experts apply consistently, even under pressure.

**Key Insight**: These aren't just good practices—they're the *thinking patterns* that make the [7 Principles](principles.md) actually work.

---

## Foundational Mindsets (Always Active)

Two mindsets are special—they're the **activation mechanism** for the entire system:

| Mindset | Function |
|---------|----------|
| **M6: Deliberate Pace Switching** | "Am I in the right mode?" — Slow down to apply principles |
| **M7: Decision Awareness** | "Am I making a decision?" — Gate to the entire system |

Without M6/M7 engaging first, the other mindsets and principles never activate. See [SKILL.md](SKILL.md#meta-level-mindsets-always-active) for details.

---

## The Ten Mental Habits

| # | Habit | Essence |
|---|-------|---------|
| **M1** | Epistemic hygiene | Separate facts, assumptions, unknowns, **implicit commitments**; update as you learn |
| **M2** | Systems thinking | Reason end-to-end, not file-by-file |
| **M3** | Trade-off fluency | "What are we optimizing for? What are we sacrificing?" |
| **M4** | Invariants-first thinking | What must remain true? Build around it |
| **M5** | Operational imagination | Run the system mentally at 2am |
| **M6** | Deliberate pace switching | Notice urgency → slow down at compounding-mistake moments |
| **M7** | Decision awareness | Notice when you're deciding, not just when you're asked to decide |
| **M8** | Execution awareness | Notice when effort diverges from progress; adapt or escalate before sunk cost compounds |
| **M9** | Diagnostic reasoning | Treat debugging as hypothesis-testing, not trial-and-error |
| **M10** | Mental model alignment | Design names for the reader's understanding, not the writer's convenience |

---

## M1: Epistemic Hygiene

> Separate facts, assumptions, unknowns, **implicit commitments**; update as you learn.

### What It Looks Like

**Without epistemic hygiene**:
> "hashCode collisions won't be a problem."

**With epistemic hygiene**:
> "hashCode collisions are a risk. **Fact**: Birthday paradox applies. **Assumption**: Our scale is small enough. **Unknown**: Actual collision rate at 10x scale. **Commitment**: By using hashCode, we're accepting this collision risk. **Action**: Calculate or measure before committing."

### Practice

At any decision point, explicitly label:
- **Facts**: What do we *know* from evidence?
- **Assumptions**: What are we *assuming* without proof?
- **Unknowns**: What *could* affect the outcome that we don't know yet?
- **Implicit Commitments**: What did we just commit to by saying "I'll just X"?

### Track Implicit Commitments

When you say these phrases, you've made a commitment. Name it:
- "I'll just put this here" → Committed to a module location
- "For now, let's..." → Committed to technical debt with unknown payoff date
- "Good enough" → Committed to a quality threshold
- "Quick fix" → Committed to a solution without full analysis

### Why It Matters

Most bad decisions come from treating assumptions as facts **and from making commitments without noticing**. Labeling them separately creates natural pause points for validation.

---

## M2: Systems Thinking

> Reason end-to-end, not file-by-file.

### What It Looks Like

**File-by-file thinking**:
> "This function returns the right value."

**Systems thinking**:
> "This function returns the right value → which gets passed to X → which writes to Y → which is read by Z at 2am → which fails if..."

### Practice

Before implementing, trace the full path:
1. Where does this data come from?
2. Where does it go?
3. What transforms it along the way?
4. What reads it at the end?
5. What happens when something in the middle fails?

### Evidence from Sessions

[CASE-MIGRATION](cases.md#case-migration-fallback-to-deprecated-system): Focused on "new database query works" without tracing the full path: "What happens when migration is 80% complete and new database query fails?"

---

## M3: Trade-off Fluency

> "What are we optimizing for? What are we sacrificing?"

### What It Looks Like

**Without trade-off fluency**:
> "Let's use approach A—it's simpler."

**With trade-off fluency**:
> "Approach A is simpler now but sacrifices flexibility for future data type additions. Approach B is more complex but handles those cases. We're optimizing for time-to-market, so A is acceptable IF we document the limitation and have a path to B."

### Practice

For every decision:
1. What are we optimizing for?
2. What are we explicitly NOT optimizing for?
3. What's the explicit trade-off we're making?
4. Under what conditions would we regret this trade-off?

### Common Trade-off Pairs

| Optimize For | Sacrifice |
|--------------|-----------|
| Simplicity | Flexibility |
| Speed to ship | Thoroughness |
| Consistency | Local optimization |
| Reversibility | Commitment |
| Correctness | Performance |

---

## M4: Invariants-First Thinking

> What must remain true? Build around it.

### What It Looks Like

**Without invariants-first**:
> "Let me implement this feature..."

**With invariants-first**:
> "Before implementing: What must ALWAYS be true? Idempotency—this operation can be retried safely. Ordering—events must be processed in sequence. Ownership—only one component writes to this data. Now I can implement respecting these constraints."

### Core Invariant Categories

| Category | Key Question |
|----------|--------------|
| **Idempotency** | Can this be safely retried? |
| **Ordering** | Does sequence matter? |
| **Ownership** | Who is the source of truth? |
| **Transaction boundaries** | What must succeed/fail together? |
| **Consistency model** | Eventual? Strong? What's the window? |

### Practice

Before writing code:
1. List 3-5 invariants that must hold
2. For each: "How would the code break this? How do I prevent it?"

---

## M5: Operational Imagination

> Run the system mentally at 2am.

### What It Looks Like

**Without operational imagination**:
> "The feature is complete and tests pass."

**With operational imagination**:
> "It's 2am. This just failed. How do I know? (Alert? Log?) How do I diagnose? (Dashboard? Trace?) How do I fix it? (Rollback? Retry?) How long will it take? (5 min? 2 hours?)"

### The 2am Test

For any system:
1. **Detection**: How do we know it's broken? (Not "we'll monitor it"—what specific signal?)
2. **Diagnosis**: How do we find the root cause? (Logs? Traces? Metrics?)
3. **Mitigation**: How do we stop the bleeding? (Rollback? Feature flag? Kill switch?)
4. **Recovery**: How do we restore service? (Retry? Manual intervention? Data fix?)
5. **Time-to-recover**: How long does each step take?

### Evidence from Sessions

[CASE-OPS](cases.md#case-ops-missing-operational-imagination): Would have failed at 2am in production. No monitoring for SSL verification failure. Discovery would be "user reports login not working."

---

## M6: Deliberate Pace Switching

> Notice urgency → slow down at compounding-mistake moments.

### The Paradox

The moments we feel most urgency ("just fix it") are exactly when slowing down matters most. Urgency triggers Fix Mode, which skips the verification loops that prevent compounding mistakes.

### Evidence from Sessions

| Episode | Urgency Signal | Tech Lead Applied | Outcome |
|---------|----------------|---------------------|---------|
| [CASE-NAMING](cases.md#case-naming-implementation-detail-in-names) | "OMG fix it right now" (Korean: "헐 지금당장 고쳐줘") | 0/3 | Abstraction issue in prod |
| (plan mode) | Plan Mode (low pressure) | 2/3 | Minor convention issue only |
| [CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component) | Error fixing under pressure | 0/2 | Pattern propagation risk |

### The 30-Second Pause Protocol

When you notice urgency signals:

```
┌────────────────────────────────────────┐
│ URGENCY DETECTED                       │
├────────────────────────────────────────┤
│ 1. Pause (30 seconds)                  │
│ 2. Ask: "Should I step back first?"    │
│ 3. If yes: Run quick verification      │
│ 4. If genuinely critical: Proceed      │
│    but flag for follow-up review       │
└────────────────────────────────────────┘
```

### Urgency Signals to Watch

- "right now" (Korean: "지금당장") / "quick fix" / "just make it work"
- Compilation errors piling up
- Deployment deadline pressure
- "We'll clean this up later"
- Frustration/stress signals

### Compounding-Mistake Moments

These are high-leverage moments where slowing down has outsized returns:
- Creating new modules/directories ([CASE-STRUCTURE](cases.md#case-structure-module-in-wrong-location))
- Choosing patterns ([CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component))
- Naming config/services ([CASE-NAMING](cases.md#case-naming-implementation-detail-in-names))
- Accepting workarounds ([CASE-ID](cases.md#case-id-temporary-without-quantification))
- Migration strategies ([CASE-MIGRATION](cases.md#case-migration-fallback-to-deprecated-system))

---

## M7: Decision Awareness

> Notice when you're deciding, not just when you're asked to decide.

### The Core Problem

The hardest decisions are the ones you make without realizing. Junior developers struggle to RECOGNIZE difficult decisions—they make commitments WITHOUT NOTICING they just made an important decision.

### What It Looks Like

**Without decision awareness**:
> "I'll just put this helper function here."
> [Later] "Why is this code in three different places now?"

**With decision awareness**:
> "I'm about to put this helper function here. Wait—that's a decision about where shared code lives. Let me check: Does this become a pattern others will copy? Where does similar code live?"

### Decision Tripwires

Watch for these language cues that signal you're making a decision:

| When you say... | You're deciding... |
|-----------------|-------------------|
| "I'll just..." | To commit to something without full analysis |
| "Quick fix...", "for now..." | To accept technical debt |
| "Good enough...", "temporary..." | Quality/permanence threshold |
| "Put it here", "hardcode it" | Structure/location |
| "Ignore this error", "catch and continue" | Failure policy |

### Boundary-Crossing Actions

These actions almost always involve significant decisions:

- New module/package/directory → Where does X live? Who owns it?
- New/changed public API → What contract are we committing to?
- New/changed data schema → What meaning are we encoding?
- New dependency/library → What are we locked into?
- New state location → What consistency guarantees?
- New failure policy → What do we do on failure?

### The 2+ Rule (Don't Cry Wolf)

Only escalate when **2+ of these** apply:
- Hard to undo in <30 min
- Affects multiple modules/teams/users
- Changes invariants, ownership, or failure behavior
- Likely to be copied as "new standard"
- Can cause silent corruption/security/compliance pain
- Takes >30 min to figure out "why" later

### Practice

Before each action, ask: "Did I just make a decision without noticing?"

1. Scan for tripwire language in what you just said
2. Check if action crosses a boundary
3. If yes, name the decision: "We are deciding **[what we're actually deciding]**"

---

## Advanced Mindsets (M8-M10)

For specialized habits covering execution monitoring, diagnostic reasoning, and naming:

| Mindset | Essence | Details |
|---------|---------|---------|
| **M8** | Notice when effort diverges from progress | [Full details](mindset-advanced.md#m8-execution-awareness) |
| **M9** | Treat debugging as hypothesis-testing | [Full details](mindset-advanced.md#m9-diagnostic-reasoning) |
| **M10** | Design names for readers | [Full details](mindset-advanced.md#m10-mental-model-alignment) |

See [Advanced Mental Habits](mindset-advanced.md) for full details.

---

## Friction Signals (Slow Down Alarms)

These indicate something is **conceptually wrong**, not just technically incomplete:

| Signal | What It Means | Principle Triggered |
|--------|---------------|---------------------|
| Can't explain the solution in 1 minute without hand-waving | Unclear mental model | P1, P3 |
| Debating structure because responsibilities are unclear | Missing concept definitions | P1, P3 |
| "Special cases" proliferate (if/else forests, one-off flags) | Wrong abstraction | P4, P6 |
| No single source of truth | Ownership undefined | P3 |
| Small change forces touching unrelated parts | Poor isolation | P4 |
| Testing feels unnatural (hidden state, non-determinism) | Design problem | P3, P5 |
| Lots of glue/conversion code | Model doesn't match reality | P3, P6 |
| Can't state failure semantics confidently | Missing contracts | P3, P5 |

### When Friction Signals Appear

**DON'T**: Push through and add more workarounds.
**DO**: Stop and ask "What's the underlying issue?"

The friction is a gift—it's telling you something is structurally wrong before it becomes expensive.

### Example: CASE-PATTERN Type Friction

**Friction**: Type projection issues with nested case class.
**Workaround attempted**: Add type alias to companion object.
**Real signal**: Case class is wrong pattern for service component.

The type system was surfacing a design problem. The workaround would hide it.

See [CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component).

---

## Building These Habits

### Habit Formation Loop

1. **Trigger**: Recognize the situation (starting task, feeling urgency, seeing friction)
2. **Routine**: Apply the habit deliberately (epistemic check, systems trace, pace switch)
3. **Reward**: Note when the habit caught something ("Without M5, this would have failed at 2am")

### Daily Practice

Pick one habit per week to focus on:
- Week 1: M1 (Epistemic hygiene) - Label facts/assumptions/unknowns/commitments in every decision
- Week 2: M2 (Systems thinking) - Trace data flow end-to-end before implementing
- Week 3: M3 (Trade-off fluency) - Explicitly state what you're optimizing for
- Week 4: M4 (Invariants-first) - List invariants before coding
- Week 5: M5 (Operational imagination) - Run the 2am test
- Week 6: M6 (Pace switching) - Practice the 30-second pause
- Week 7: M7 (Decision awareness) - Scan for tripwire language before each action
- Week 8: M8 (Execution awareness) - Ask "what evidence do I have vs an hour ago?" at each checkpoint
- Week 9: M9 (Diagnostic reasoning) - State hypothesis and prediction before each debugging action
- Week 10: M10 (Mental model alignment) - Ask "who reads this? what do they expect?" for each name

### Integration with Principles

| Habit | Primary Principles |
|-------|-------------------|
| M1 Epistemic hygiene | P2 (uncertainty), P7 (decisions) |
| M2 Systems thinking | P3 (contracts), P5 (feedback loops) |
| M3 Trade-off fluency | P1 (job definition), P4 (isolate volatility) |
| M4 Invariants-first | P3 (contracts), P5 (feedback loops) |
| M5 Operational imagination | P5 (feedback loops), P4 (reversibility) |
| M6 Pace switching | ALL—especially under pressure |
| M7 Decision awareness | ALL—especially P7 (write down the decision) |
| M8 Execution awareness | P1 (outcome clarity), P5 (feedback loops), Effectiveness Contract |
| M9 Diagnostic reasoning | P2 (uncertainty), P5 (feedback loops), M1, M2, M8 |
| M10 Mental model alignment | P3 (make meaning explicit), P4 (isolate volatility), P6 (consistency) |

---

## Related Documents

- [Advanced Mental Habits](mindset-advanced.md) - M8-M10: execution, debugging, naming
- [Principles](principles.md) - The constraints these habits enforce
- [Effectiveness](effectiveness.md) - Measuring whether habits are working
- [Speculation Protocol](speculation.md) - Structured approach when M2/M4 need depth
