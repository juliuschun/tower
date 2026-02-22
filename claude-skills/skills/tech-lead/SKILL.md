---
name: tech-lead
description: |
  Develop adaptive expert judgment through principles, not checklists.
  Use when: making architectural decisions, creating new modules/patterns,
  accepting workarounds, seeing friction signals, detecting decision tripwires,
  or when phrases like "I'll just...", "temporary", "for now" appear.
argument-hint: "[kickoff|speculation|planning|review]"
---

# Tech Lead

**Purpose**: Develop adaptive expert judgment through principles, not checklists.

**Core Insight**: The gap isn't capability—it's activation. You may perform well in structured mode but inconsistently activate expert behaviors under pressure. This skill helps activate expert reasoning more consistently.

---

## Philosophy

### From Checklists to Principles

**Old approach**: Situation → Checklist → Action
**New approach**: Principle → Recognition → Adaptive Response

Checklists tell you *what* to check. Principles tell you *how to think*. The goal is to internalize the thinking, not memorize the checks.

### The Real Expertise Gap

You DO try to understand. But you may lack:
- **Speculative thinking depth**: Can't explore enough "what-if" scenarios
- **Context-sensitive intuition**: Doesn't know what's good/bad in THIS project

"Understand before proposing" is too shallow. The skill addresses what to look for and how deep to go.

---

## Quick Navigation

| Need | Document |
|------|----------|
| **Getting started** | This file (SKILL.md) |
| **Core principles (P1-P7)** | [principles.md](principles.md) |
| **Foundational habits (M1-M7)** | [mindset.md](mindset.md) |
| **Advanced habits (M8-M10)** | [mindset-advanced.md](mindset-advanced.md) |
| **Naming decisions** | [naming.md](naming.md) |
| **Self-assessment** | [effectiveness.md](effectiveness.md) |
| **Project kickoff** | [kickoff.md](kickoff.md) |
| **Task planning** | [planning.md](planning.md) |
| **Deep design** | [speculation.md](speculation.md) |
| **When to escalate** | [escalation.md](escalation.md) |
| **Worked examples** | [cases.md](cases.md) |

---

## Skill Structure

| Document | Purpose |
|----------|---------|
| [**cases.md**](cases.md) | Central repository of worked examples |
| [**principles.md**](principles.md) | 7 core principles with worked examples |
| [**mindset.md**](mindset.md) | Foundational habits M1-M7 + friction signals |
| [**mindset-advanced.md**](mindset-advanced.md) | Advanced habits M8-M10 (execution, debugging, naming) |
| [**naming.md**](naming.md) | Expert naming strategies for identifiers |
| [**effectiveness.md**](effectiveness.md) | Self-assessment without senior review |
| [**speculation.md**](speculation.md) | Deep understanding before proposing |
| [**escalation.md**](escalation.md) | When to ask for help |
| [**kickoff.md**](kickoff.md) | Project kickoff with Decision Requirement Table |
| [**planning.md**](planning.md) | 15-Minute Planning Ritual for task execution |
| [**prompts/core.md**](prompts/core.md) | Consolidated principle-based prompts |
| [**testing.md**](testing.md) | Classification Gym for skill validation (dev only) |
| [**DEVELOPMENT.md**](DEVELOPMENT.md) | Meta-documentation for skill evolution (dev only) |

### Document Responsibilities (Separation of Concerns)

Each document has a clear responsibility. When adding content, place it in the right home:

| Concern | Authoritative Document | Other Docs Should |
|---------|----------------------|-------------------|
| **What principles guide decisions** | principles.md | Link, not duplicate |
| **How to think (foundational habits M1-M7)** | mindset.md | Link, not duplicate |
| **Friction signals (warning signs)** | mindset.md | Link, not duplicate |
| **Advanced habits (M8-M10)** | mindset-advanced.md | Link, not duplicate |
| **Self-assessment & contracts** | effectiveness.md | Reference structure |
| **Execution monitoring (applying M8)** | effectiveness.md | Link to mindset-advanced for M8 definition |
| **Root cause analysis** | effectiveness.md | Link, not duplicate |
| **Worked examples** | cases.md | Link, not duplicate |
| **When to escalate** | escalation.md | Link, not duplicate |
| **Project-level decisions** | kickoff.md | Reference, not duplicate |
| **Task-level planning** | planning.md | Reference, not duplicate |
| **Design exploration** | speculation.md | Reference, not duplicate |
| **Decision tripwires** | This file (SKILL.md) | Link to here |

**Key Boundaries**:
- **mindset-advanced.md** defines *what* M8/M9/M10 are; **effectiveness.md** shows *how to apply* them
- **principles.md** defines *what* P1-P7 are; **prompts/core.md** provides *quick reference*
- **cases.md** is the *single source of truth* for worked examples; others should link

---

## The 7 Principles

| # | Principle | Catch Question |
|---|-----------|----------------|
| **P1** | Define the job and the edges | "What's success? What are non-goals?" |
| **P2** | Treat uncertainty as the real work | "What's the riskiest assumption?" |
| **P3** | Make meaning explicit | "What must always be true?" |
| **P4** | Isolate volatility | "If we change X, is this still true?" |
| **P5** | Short, truthful feedback loops | "How will we know it's broken?" |
| **P6** | Consistency is a feature | "Where does similar live?" |
| **P7** | Write down the decision | "Context → Options → Decision → Why" |

See [principles.md](principles.md) for full details and worked examples.

---

## Meta-Level Mindsets (Always Active)

Before any principle can apply, these mindsets must engage. They are not "two of nine mindsets"—they're the **activation mechanism** for the entire system.

| Mindset | Function | Catch Question |
|---------|----------|----------------|
| **M6: Deliberate Pace Switching** | "Am I in the right mode?" | Notice urgency → slow down to apply principles |
| **M7: Decision Awareness** | "Am I making a decision?" | Gate to the entire system; notice before committing |

**Why these are foundational**: Gary Klein's Recognition-Primed Decision model shows that experts first recognize they're in a decision situation (M7), then adjust their cognitive mode (M6). Without these, the other principles never activate.

See [mindset.md](mindset.md) for foundational habits M1-M7, and [mindset-advanced.md](mindset-advanced.md) for advanced habits M8-M10.

---

## How Principles and Mindsets Connect

The 7 Principles define *what to do*. The 10 Mindsets define *how to think*. They work together:

| Principle | Primary Mindsets | Relationship |
|-----------|-----------------|--------------|
| **P1** (Define job) | M3 (Trade-offs) | M3 surfaces what to optimize/sacrifice when defining scope |
| **P2** (Uncertainty) | M1 (Epistemic hygiene) | M1 is the tool for executing P2—separate facts from assumptions |
| **P3** (Contracts) | M4 (Invariants-first), M10 (Naming) | M4 is the mental routine for P3; M10 ensures names reflect contracts |
| **P4** (Volatility) | M2 (Systems), M3 (Trade-offs), M10 (Naming) | Predict change; M10 ensures names survive change |
| **P5** (Feedback) | M5 (Operational imagination), M8 (Execution) | M5 designs what to monitor; M8 monitors during execution |
| **P6** (Consistency) | M2 (Systems thinking), M10 (Naming) | M2 sees ecosystem coherence; M10 checks naming patterns |
| **P7** (Write decision) | M7 (Decision awareness) | Sequential: M7 (notice) → P7 (record) |

**Key insight**: You can have a principle without its mindset (P5 alerts without M5 mental model = false confidence), or a mindset without its principle (M4 thinking without P3 documentation = tribal knowledge). Both are needed.

---

## Decision Tripwires

**Core Problem**: Junior developers struggle to RECOGNIZE difficult decisions. They make commitments WITHOUT NOTICING they just made an important decision.

### Language Tripwires (Hidden Commitment Cues)

When these phrases appear, a decision is likely being made without recognition:

| Phrase Pattern | What It Signals |
|---------------|-----------------|
| "I'll just...", "quick fix...", "for now..." | Deferred decision disguised as non-decision |
| "temporary...", "good enough...", "we'll clean up later..." | Accepting technical debt without quantifying |
| "put it here", "hardcode it", "ship it" | Commitment to structure/location |
| "ignore this error", "catch and continue" | Failure policy decision |
| "I'll just call it..." | Naming without deliberation (M10) |
| "...Helper/Manager/Utils" | Responsibility unclear; dumping ground risk (M10) |
| "Same as the library calls it" | External vocabulary leak (M10, P4) |
| "For now..." (naming) | Temporary name becoming permanent (M10) |

### Boundary-Crossing Actions (Usually Real Decisions)

These actions almost always involve significant decisions:

| Action | Hidden Decision |
|--------|-----------------|
| New module/package/directory | Where does X live? Who owns it? |
| New "shared utils" | What's the dependency graph? |
| New/changed public API | What contract are we committing to? |
| New/changed data schema | What meaning are we encoding? What migrations? |
| New dependency/library | What are we locked into? |
| New state location (DB vs cache vs memory) | What consistency guarantees? |
| New failure policy (retry/timeout/fallback) | What do we do on failure? |
| New concurrency model | What ordering/idempotency guarantees? |

### Code Smell Tripwires (Accidental Policy Decisions)

- `TODO/FIXME` with no deadline/owner
- `// temporary`, "HACK" comments
- Catch-all exception handling
- Silent defaults, magic constants
- Copy/paste of a pattern that will replicate

### Meta-Question Tripwire

Questions framed as "What's the correct practice/pattern?" with missing context are often **proxies** for deeper decisions about boundaries, volatility, and failure semantics.

**Example**: "What's the correct practice for facade pattern?" actually asks:
- What volatility are we isolating?
- What failure semantics should the facade preserve?
- What's the boundary this creates?

---

## Decision-ness Filter (Don't Cry Wolf)

Only escalate when **2+ of these** apply:

| Factor | Question |
|--------|----------|
| **Reversibility** | Hard to undo in <30 min? Needs migration/coordination? |
| **Reach** | Affects multiple modules/teams/users/environments? |
| **Contract** | Changes invariants, ownership, failure behavior, data meaning? |
| **Precedent** | Likely to be copied as "new standard"? |
| **Risk tail** | Can cause silent corruption/security/compliance/oncall pain? |
| **Re-derivation cost** | Takes >30 min to figure out "why" later? |

**Non-decisions**: Local refactors, formatting, isolated implementation details, trivially reversible edits.

---

## Decision Surfacing Loop (Run Every Turn)

Add this protocol that runs **before** answering:

### Step 1: Scan for Tripwires

- Check user message/diff/plan for language tripwires and boundary-crossing actions
- Turn each into a sentence: "We are deciding **where X lives**" / "We are deciding **what we do on failure**"

### Step 2: Score Decision-ness

- Apply the 2+ filter from above
- Pick **top 1-3** decisions only

### Step 3: Output Decision Callout (for each)

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

### Step 4: Continue with User's Request

After the callout, proceed with the original request.

---

## When to Use This Skill

### Trigger-Based Gates (Not Process)

Only run the full ritual when:
- **(a) New module/pattern/config** - P6, P1, P7 apply
- **(b) Data correctness risk** - P2, P3, P5 apply
- **(c) Migration/fallback** - P1, P4, P5 apply
- **(d) "Urgent fix mode" detected** - All principles, especially M6 (pace switching)
- **(e) Decision tripwire detected** - Run Decision Surfacing Loop
- **(f) Planning tripwire detected** - Run [Planning Ritual](planning.md)

### Two Tiny Rituals

**Start-of-task (3 min)**:
1. P1: What's success? What are non-goals?
2. P2: What are the top 2 unknowns?
3. P6: "Where does similar live?"

**Pre-merge (2 min)**:
1. P5: How will we know it's broken?
2. P3: What are 1-2 invariants?
3. P7: Record decision in 5 bullets

---

## Effectiveness Contract

Before significant work, fill out (3-6 lines):

```
Outcome: [1 sentence]
Evidence: [how we prove it worked]
Non-goals: [what we won't touch]
Risks: [what could go wrong]
Rollback: [how to undo]
Timebox: [when to reassess]
```

This integrates all 7 principles into a single forcing function. See [effectiveness.md](effectiveness.md).

---

## Friction Signals (Slow Down Alarms)

These indicate something is **conceptually wrong**:

- Can't explain the solution in 1 minute without hand-waving
- Debating structure because responsibilities are unclear
- "Special cases" proliferate (if/else forests)
- No single source of truth
- Small change forces touching unrelated parts
- Testing feels unnatural
- Can't state failure semantics confidently

When you see friction signals: **STOP and ask "What's the underlying issue?"**

See [mindset.md](mindset.md) for the full friction signals table.

---

## Speculation Protocol

Before proposing structure, run the 30-45 minute routine:

1. **Enumerate Usage Patterns** (10 min) - 3 current, 3 next-milestone, 4 maybe-later
2. **Draw Two Diagrams** (10 min) - Concept map + Data flow
3. **List Invariants** (5 min) - What must be true? What can't change?
4. **Pre-Mortem** (10 min) - "In 6 months this is painful because..."
5. **ADR Stub** (5 min) - Problem → Options → Criteria → Decision

See [speculation.md](speculation.md) for AI-assisted modes and expert questions.

---

## Learning Loop

### After Each Incident/PR

5-minute replay: "Which principle would have caught this earlier?"
→ Add one line to "Principles in the wild" log

### Pattern → Script Compilation

Convert repeated misses into single-line triggers:
- "new module → Convention check"
- "temporary ID → quantify risk + timeline"
- "structure question → usage patterns first"

### Gradual Automation

Only where it pays off: small checks/lints/tests that enforce contracts you keep rediscovering.

---

## Deployment/Monitoring (Avoid Overengineering)

### Minimum Viable Observability

- `last_success_at` - When did it last work?
- `run_duration` - How long did it take?
- `records_in/out` - Did data flow through?
- `freshness_lag` - How stale is the data?
- `error_reason` - Why did it fail?

### 3 Alerts Max (Per Critical Pipeline)

1. "Job failed" - immediate action
2. "Data stale" - investigate freshness
3. "Record-count anomaly" - data quality check

### Abstraction-Level Naming

- `objectStorage` not `minio`
- `primaryDb` not `postgres`
- Names should survive implementation changes

---

## Hidden Decisions in Practice

| Hidden Decision | Case Study | Tripwire Missed | How to Surface |
|-----------------|------------|-----------------|----------------|
| Module placement without usage analysis | [CASE-RESOLVER](cases.md#case-resolver-proposals-without-understanding) | "put it here" → Where does X live? | Decision Surfacing Loop |
| Pattern choice without checking fit | [CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component) | "I'll just use this pattern" | P6: "Do we already do this?" |
| Risk acceptance without quantification | [CASE-ID](cases.md#case-id-temporary-without-quantification) | "temporary", "for now" | P2: "Riskiest assumption?" |
| Naming that leaks implementation | [CASE-NAMING](cases.md#case-naming-implementation-detail-in-names) | "quick fix" under pressure | P4: "If we change backend?" |
| Fallback strategy without success criteria | [CASE-MIGRATION](cases.md#case-migration-fallback-to-deprecated-system) | "good enough for now" | P1: "Non-goals" + lifecycle |

---

## Verification Checklist

Use this to verify the skill is working:

- [ ] **Coverage test**: Can you map each principle to failure cases it catches?
- [ ] **Lightness test**: Can rituals be done in <5 min total?
- [ ] **Adaptation test**: Do principles apply to planning, design, implementation, PR, deployment?
- [ ] **Learning test**: Are you building pattern library through experience?
- [ ] **Decision surfacing test**: Are you detecting hidden decisions before they become commitments?
- [ ] **Self-feedback test**: Can you assess effectiveness WITHOUT senior review?
- [ ] **Planning test**: Are you detecting planning tripwires and structuring around unknowns?
- [ ] **Execution awareness test**: Are you catching drift signals (scope creep, sunk cost, progress illusion) during work?
- [ ] **Diagnostic reasoning test**: When debugging, are you forming hypotheses with predictions before testing?

---

## Quick Reference

### The Essentials

| When | Do |
|------|-----|
| Starting any significant task | Fill Effectiveness Contract |
| Creating new structure | Ask "Where does similar live?" |
| Accepting workaround | Quantify failure probability + timeline |
| Feeling urgency | 30-second pause → "Should I step back?" |
| Seeing friction signals | Stop and find underlying issue |
| Before proposing structure | Run Speculation Protocol |
| After completing task | 2-minute retro: 1 keep, 1 change |

### Escalation Triggers

These require tech lead confirmation:
- New top-level directory/module
- New pattern (not in codebase)
- Core domain model changes
- Ambiguous requirements
- Quality vs urgency trade-off

See [escalation.md](escalation.md) for full protocol.

---

## Learning Path

Not everyone needs all 15 items at once. This progression builds from safety to strategy.

### Phase 1: Safe Contributor (Junior)

*Focus: Execution without regression*

| Item | Mantra | Protects Against |
|------|--------|------------------|
| **P6** (Consistency) | "Copy the existing pattern" | Sprawling incoherent codebases |
| **P1** (Define the Job) | "Know what done looks like" | Wasted effort on non-goals |
| **M1** (Epistemic Hygiene) | "Label your guesses" | Silent catastrophic assumptions |
| **M6** (Pace Switching) | "If stuck, STOP" | Compounding mistakes under pressure |

### Phase 2: Reliable Engineer (Mid-Level)

*Focus: Production readiness and quality*

| Item | Mantra | Protects Against |
|------|--------|------------------|
| **P5** (Feedback Loops) | "How do I know if it breaks?" | Ship-and-pray |
| **M5** (Operational Imagination) | "What happens at 2am?" | Operability gaps |
| **P7** (Write Decisions) | "Document the why" | Organizational amnesia |
| **M8** (Execution Awareness) | "Track progress vs. effort" | Rabbit holes and drift |

### Phase 3: Tech Lead (Senior)

*Focus: Architecture and strategy*

| Item | Mantra | Protects Against |
|------|--------|------------------|
| **P2** (Uncertainty) | "Kill risks, not just build features" | Unknown-unknown blowups |
| **P3** (Contracts) | "Design robust boundaries" | Leaky APIs, subtle bugs |
| **M2** (Systems Thinking) | "Optimize the whole" | Local optimizations that harm the system |
| **M3** (Trade-off Fluency) | "Make hard calls" | Analysis paralysis or unconsidered trade-offs |
| **P4** (Isolate Volatility) | "Architecture for change" | Irreversible architecture traps |

**Note**: M4 (Invariants-first) and M7 (Decision awareness) are embedded—M4 is how you execute P3, M7 is how you execute P7.

---

## Evidence Base

This skill was derived from analysis of real coding sessions between a junior developer and senior tech lead, identifying patterns where expert judgment was needed. The case studies in [cases.md](cases.md) are based on actual decision episodes. Research synthesis includes Kent Beck's work on uncertainty, Gary Klein's Recognition-Primed Decision model, and startup observability practices.

