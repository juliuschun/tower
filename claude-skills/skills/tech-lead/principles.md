# 7 Core Principles for Expert Judgment

**Purpose**: Adaptive principles that apply across all phases of work—planning, design, implementation, PR, deployment.

**Key Insight**: These principles enforce *constraints* on decision-making. [Effectiveness](effectiveness.md) sets *what "good" looks like*.

**How they connect to Mindsets**: Each principle has one or more mindsets that enable it. See [SKILL.md](SKILL.md#how-principles-and-mindsets-connect) for the full mapping.

---

## The Principles

| # | Principle | Essence |
|---|-----------|---------|
| **P1** | Define the job and the edges | Know success + non-goals before designing |
| **P2** | Treat uncertainty as the real work | "What don't we know that could sink us?" |
| **P3** | Make meaning explicit (contracts over code) | Semantic correctness: invariants, ownership, idempotency |
| **P4** | Optimize for change by isolating volatility | Reversible decisions early; hard commits when learned enough |
| **P5** | Short, truthful feedback loops | Know quickly if you're right; delayed feedback → Fix Mode drift |
| **P6** | Consistency is a feature | Reuse existing patterns; novelty has ongoing tax |
| **P7** | Write down the decision, not details | Context → Options → Decision → Trade-offs |

---

## P1: Define the Job and the Edges

> Know success + non-goals before designing.

### Essence

Before proposing a solution, understand:
- What outcome are we trying to achieve?
- What's explicitly *not* in scope?
- What are the current and future usage patterns?

### Catch Question

**"What's success for this? What are we NOT doing?"**

### Decision Tripwires for P1

**Language cues**:
- "put it here" → Where does X live? What's the scope?
- "add this feature" → What are we NOT adding?
- "Is this structure right?" → Meta-question—define usage patterns first

**Boundary-crossing actions**:
- New module/directory → Define scope and non-goals before creating
- New API endpoint → What's the contract? What's out of scope?

### Hidden Decision Pattern: Proposals Without Understanding

When asked "is this structure natural?" or "what's the best approach?", the instinct is to immediately propose options. This is backwards.

**Wrong**: "Here are 3 options for organizing this..."
**Right**: "Before proposing structure, let me understand: What are the usage patterns? How will this be called? What might change?"

### Worked Example: CASE-RESOLVER

**Situation**: Asked "Is this resolver concept natural under storage?" (Korean: "이 resolver 개념은 storage 밑에 있는게 자연스러운가요?")

**What happened**: Immediately proposed structure options without understanding:
- Current/future usage patterns
- Why name includes "s3" when no s3 code exists
- Concept definitions

**Feedback**: "I can't tell without examining current/future usage patterns one by one." (Korean: "현재/미래 사용패턴을 하나씩 뜯어본게 아니라서 이것만 봐서는 잘 모르겠어요")

**Principle applied**: Before proposing, enumerate usage patterns first. See [Speculation Protocol](speculation.md) and [CASE-RESOLVER](cases.md#case-resolver-proposals-without-understanding).

### Worked Example: CASE-MIGRATION

**Situation**: Migration from deprecated legacy system to new database.

**Missing P1**: Never defined what "success" meant for this migration. Was it:
- "New database works" (feature complete)?
- "Legacy system is retired" (migration complete)?
- "No data loss during transition" (safety)?

**Consequence**: Built fallback to deprecated system without questioning whether fallback was the right strategy.

**Better**: "What's the success criteria? If new database fails, should we fail-loud (surface problems early) or graceful-degrade (hide problems temporarily)?"

See [CASE-MIGRATION](cases.md#case-migration-fallback-to-deprecated-system).

---

## P2: Treat Uncertainty as the Real Work

> "What don't we know that could sink us?"

### Essence

Uncertainty isn't a distraction from "real work"—addressing uncertainty *is* the work. Identify assumptions and validate the riskiest ones first.

### Catch Question

**"What's the riskiest assumption and fastest way to validate it?"**

### Decision Tripwires for P2

**Language cues**:
- "temporary", "for now", "good enough" → Accepting risk without quantifying
- "we'll clean up later" → Deferred work without timeline
- "probably won't happen" → Assumption masquerading as fact

**Code smell tripwires**:
- `TODO/FIXME` with no deadline/owner
- `// temporary`, "HACK" comments
- Silent defaults, magic constants

### Kent Beck on Uncertainty

> "I don't understand why you would insist on making the maximum number of decisions in conditions of maximum uncertainty and minimum knowledge."

### Worked Example: CASE-ID

**Situation**: Using hashCode for unique ID generation without DB.

**Hidden uncertainty**: "hashCode collisions won't happen at our scale."

**What P2 requires**:
1. Quantify: "What's the collision probability at current scale? At 10x scale?"
2. Impact: "What happens when collision occurs?" (Data corruption—severe)
3. Validate: Either prove collision is acceptable or choose different approach.

**Outcome without P2**: "TEMPORARY SOLUTION" comment, no timeline, no quantification, collision silently corrupts data.

See [CASE-ID](cases.md#case-id-temporary-without-quantification).

---

## P3: Make Meaning Explicit (Contracts Over Code)

> Semantic correctness: invariants, ownership, idempotency.

### Essence

Code can be correct syntactically but wrong semantically. Make the implicit explicit:
- What invariants must hold?
- Who owns this data/resource?
- Is this operation idempotent? What's the consistency model?

### Catch Question

**"What must always be true? Who owns this?"**

### Decision Tripwires for P3

**Language cues**:
- "ignore this error", "catch and continue" → Failure policy decision
- "just store it here" → Ownership decision
- "it should work" → Missing invariant definition

**Boundary-crossing actions**:
- New/changed data schema → What meaning are we encoding?
- New state location → What consistency guarantees?
- New public API → What contract are we committing to?

### Worked Example: CASE-NAMING

**Situation**: Named config namespace `storage.minio` for S3-compatible storage.

**Implicit meaning broken**: "MinIO" is a local dev implementation, but production uses actual S3. The name exposes implementation detail.

**What P3 requires**: "If we change backend from MinIO to actual S3, is this name still true?"

**Better names**: `storage.s3` (service-level) or `storage.objectStorage` (abstraction-level)

See [CASE-NAMING](cases.md#case-naming-implementation-detail-in-names).

### Invariants Checklist

When working with data or state:
- Transaction boundaries: What must succeed/fail together?
- Ordering: Does sequence matter?
- Idempotency: Can this be safely retried?
- Ownership: Who is source of truth?

---

## P4: Optimize for Change by Isolating Volatility

> Reversible decisions early; hard commits when learned enough.

### Essence

Separate what changes from what stays stable. Make reversible decisions early; delay irreversible commitments until you've learned enough.

### Catch Question

**"If we change [X], is this still true? What's the blast radius?"**

### Decision Tripwires for P4

**Language cues**:
- "quick fix" → May lock in implementation detail
- "hardcode it" → Consuming options
- "ship it" → Are we ready to commit?

**Boundary-crossing actions**:
- New dependency/library → What are we locked into?
- New naming choice → If implementation changes, is name still true?
- New concurrency model → What ordering guarantees?

### Kent Beck on Options

> "In a chaotic situation, options are better than things."

### Creates vs Consumes Options

| Creates Options | Consumes Options |
|-----------------|------------------|
| Adds tests/telemetry | Commits to schema/API |
| Reduces coupling | Removes old path |
| Introduces adapter/flag | Introduces global coupling |
| Keeps old path working | Irreversible migrations |
| Clarifies contracts | Big-bang rewrites |

**Rule**: Before consuming options, ensure you have evidence + a hedge (adapter/flag/migration plan).

### Worked Example: CASE-NAMING

**Volatility isolated badly**: Config namespace `minio` couples to implementation detail.

**Better isolation**: Use abstraction-level naming (`objectStorage` not `minio`, `primaryDb` not `postgres`). The name survives implementation changes.

See [CASE-NAMING](cases.md#case-naming-implementation-detail-in-names).

---

## P5: Short, Truthful Feedback Loops

> Know quickly if you're right; delayed feedback → Fix Mode drift.

### Essence

Delayed feedback leads to drift. Create mechanisms to know quickly whether you're on track. Don't rely on "we'll monitor it" without specifying what triggers action.

### Catch Question

**"How will we know it's broken? What alert triggers action?"**

### Decision Tripwires for P5

**Language cues**:
- "it works" → But how do we know when it stops working?
- "we'll monitor it" → What specific signal? What threshold?
- "users will report it" → That's not a feedback loop, that's discovery via pain

**Boundary-crossing actions**:
- New failure policy (retry/timeout/fallback) → How do we detect failures?
- New external integration → What's the 2am detection story?

### Evidence from Sessions

| Episode | Urgency | Tech Lead | Outcome |
|---------|---------|--------------|---------|
| CASE-NAMING | High ("right now") | 0/3 | Abstraction issue in prod |
| (plan mode) | Low (plan mode) | 2/3 | Minor convention issue only |
| CASE-PATTERN | High (error fixing) | 0/2 | Pattern propagation risk |

Under urgency, feedback loops get skipped. This is exactly when they're most needed.

### Minimum Viable Observability

- `last_success_at` - When did it last work?
- `run_duration` - How long did it take?
- `records_in/out` - Did data flow through?
- `freshness_lag` - How stale is the data?
- `error_reason` - Why did it fail?

### 3 Alerts Max (Per Critical Pipeline)

1. "Job failed" - immediate action required
2. "Data stale" - investigate freshness
3. "Record-count anomaly" - data quality check

---

## P6: Consistency Is a Feature

> Reuse existing patterns; novelty has ongoing tax.

### Essence

Every deviation from existing patterns creates ongoing cognitive and maintenance tax. Before introducing something new, check what already exists.

### Catch Question

**"Where does similar live? Do we already do this here?"**

### Decision Tripwires for P6

**Language cues**:
- "I'll just create..." → Check existing patterns first
- "I'll use this pattern" → Is it the pattern used elsewhere?
- "This is how I usually do it" → But is it how THIS codebase does it?

**Boundary-crossing actions**:
- New module/package/directory → Where does similar live?
- New "shared utils" → What's the dependency graph?
- Copy/paste of a pattern → Will this replicate as "new standard"?

### Worked Example: CASE-STRUCTURE

**Situation**: Creating new domain module.

**What happened**: Created `domain/` at top level without checking that `data/ingestion/` exists—data modules go under `data/`.

**P6 applied**: "Where are similar modules?" (Korean: "비슷한 모듈이 어디에 있어?") → Check `data/` first → `data/[module]` is consistent.

See [CASE-STRUCTURE](cases.md#case-structure-module-in-wrong-location).

### Worked Example: CASE-PATTERN

**Situation**: Type errors when using case class for a service component.

**What happened**: Worked around type issues without questioning pattern fit.

**P6 applied**: "Are there other examples of using case class in service modules?" (Korean: "서비스 모듈에서 case class를 쓰는 다른 예가 있어?") → No, services use object or class → Wrong pattern.

See [CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component).

### Convention Discovery Ritual

Before creating new structure:
1. `ls -la [parent]/` - Check sibling locations
2. `grep -r "similar.*pattern" .` - Find existing patterns
3. If no similar exists → Explicit decision, not accident

---

## P7: Write Down the Decision, Not Details

> Context → Options → Decision → Trade-offs.

### Essence

**First, recognize you're making a decision.** Then document *why*, not just *what*.

Decisions are lost when:
1. You don't notice you're making one (the harder problem)
2. Only implementation details are recorded (the easier problem)

Before documenting, ask: "Did I just make a decision without noticing?"
- Scan for tripwires (language cues, boundary-crossing actions)
- Apply the 2+ decision-ness filter
- If yes, document it

### Decision Record Format (5 bullets max)

```
Problem: [1 sentence]
Options: [2-3 alternatives considered]
Decision: [What we chose]
Why: [Trade-off reasoning]
What would change my mind: [Falsifiable condition]
```

### Why This Matters

6 months later, someone (including you) will ask: "Why is this like this?" The code shows *what*. The decision record shows *why*.

### When to Write ADRs

- New module/pattern/architecture
- Migration strategy chosen
- Technology selection
- Any decision that would require >30 min to re-derive

### Decision Tripwires for P7

**Language cues that signal undocumented decisions**:
- "I'll just..." → You're committing to something. Document it.
- "For now..." → You're accepting technical debt. Quantify it.
- "Good enough..." → You're making a trade-off. Record it.

**Actions that require documentation**:
- New public API or contract
- New failure policy
- New state location
- Any boundary-crossing action from the [Decision Tripwires](SKILL.md#decision-tripwires)

---

## Failure Case Coverage

Each principle maps to specific failure cases. See [cases.md](cases.md) for full details.

| Case | Principles | Catch Question |
|------|------------|----------------|
| [CASE-STRUCTURE](cases.md#case-structure-module-in-wrong-location) | P6, P1, P7 | "Where does similar live?" |
| [CASE-ID](cases.md#case-id-temporary-without-quantification) | P2, P3, P5 | "What's the collision probability + blast radius?" |
| [CASE-NAMING](cases.md#case-naming-implementation-detail-in-names) | P4, P6, P3 | "If we change backend, is this name still true?" |
| [CASE-MIGRATION](cases.md#case-migration-fallback-to-deprecated-system) | P1, P2, P5, P7 | "What's success for migration? Fail-loud or fallback?" |
| [CASE-PATTERN](cases.md#case-pattern-wrong-pattern-for-component) | P6, P1, P5 | "Do we already do this pattern here?" |
| [CASE-RESOLVER](cases.md#case-resolver-proposals-without-understanding) | P1, P6, P3 | "What's the usage pattern before proposing structure?" |

---

## Using the Principles

### Start-of-Task (3 min)

1. **P1**: What's success? What are non-goals?
2. **P2**: What are the top 2 unknowns?
3. **P6**: "Where does similar live?"

### Pre-Merge (2 min)

1. **P5**: How will we know it's broken?
2. **P3**: What are 1-2 invariants/contracts?
3. **P7**: Record decision in 5 bullets

### Under Pressure

When feeling urgency, these are the moments principles matter most. See [Mindset: Deliberate Pace Switching](mindset.md#deliberate-pace-switching).

---

## Related Documents

- [Mindset Properties](mindset.md) - Mental habits + friction signals
- [Effectiveness](effectiveness.md) - Self-assessment without senior review
- [Speculation Protocol](speculation.md) - Deep understanding before proposing
- [Escalation](escalation.md) - When to ask for help
