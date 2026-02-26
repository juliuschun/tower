# Speculation Protocol: Deep Understanding Before Proposing

**Purpose**: Develop speculative thinking depth and context-sensitive intuition—the skills that separate experts from competent practitioners.

**Key Problem**: You DO try to understand. But you may lack:
- **Speculative thinking depth/width**: Can't explore enough "what-if" scenarios
- **Context-sensitive intuition**: Doesn't know what's good/bad in THIS specific project

**"Understand before proposing" is too shallow** because you ARE trying to understand—you just don't know WHAT to look for or HOW DEEP to go.

---

## When to Use This Protocol

Before proposing structure, architecture, or significant design decisions—especially when asked:
- "Is this structure natural?"
- "What's the best approach for X?"
- "How should we organize this?"
- Any question that tempts immediate proposal

### Hidden Decision Example: CASE-RESOLVER

**Situation**: Asked "Is this resolver concept natural under storage?" (Korean: "이 resolver 개념은 storage 밑에 있는게 자연스러운가요?")

**Hidden Decision Detected**: Where should this module live? What ownership boundaries are we creating?

**Tripwire Missed**: The question "Is this structure right?" is a meta-question tripwire—it's asking about placement without first defining what the module does and who uses it.

**What happened**: Immediately proposed structure options without understanding:
- Current/future usage patterns
- Why name includes "s3" when no s3 code exists
- Concept definitions

**What Decision Surfacing Would Have Caught**:
- "We are deciding **where this module lives**"
- Decision Requirements: Must understand usage patterns, must identify owner, must check conventions

**Feedback**: "I can't tell without examining current/future usage patterns one by one." (Korean: "현재/미래 사용패턴을 하나씩 뜯어본게 아니라서 이것만 봐서는 잘 모르겠어요")

See [CASE-RESOLVER](cases.md#case-resolver-proposals-without-understanding).

---

## Decision Requirement Table (Speculation Output)

After speculation, produce a Decision Requirement Table that captures the key decisions and their requirements.

| Decision | Stakes | Requirements (must/should) | Evidence Needed | Reversibility |
|----------|--------|---------------------------|-----------------|---------------|
| Where does module X live? | Affects discoverability, dependency graph | Must follow existing conventions; must honor prior agreements | Check existing structure, ask about conventions | Easy if caught early |
| What's the failure policy? | Silent failures = oncall pain | Must be observable; must preserve error context | Trace failure paths | Medium - logging changes |
| What data schema? | Migration cost if wrong | Must support known use cases; should support likely future | List 3 current + 3 future usage patterns | Hard - requires migration |

This table integrates with the [Project Kickoff](kickoff.md) and feeds into [ADR documentation](principles.md#p7-write-down-the-decision-not-details).

---

## The 30-45 Minute Speculation Routine

Use this before proposing significant structure. Each step builds on the previous.

### Step 1: Enumerate Usage Patterns (10 min)

List concrete usage scenarios:

| Category | Pattern | Example |
|----------|---------|---------|
| **3 Current** | How is this used right now? | "Called by X to do Y when Z" |
| **3 Next-Milestone** | What's coming in the near future? | "When we add new data types, it will need..." |
| **4 Maybe-Later** | Edge cases and worst-case scenarios | "If we need multi-tenant, then..." |

**Why 10 patterns?** Forces breadth. First 3 are obvious; patterns 7-10 reveal hidden requirements.

### Step 2: Draw Two Diagrams (10 min)

**(a) Concept Map**
- Domain nouns (entities)
- Boundaries (what owns what)
- Ownership arrows
- "Where does X live?"

**(b) Data Flow**
- Read paths
- Write paths
- Where state lives
- Failure/redo paths

These diagrams reveal questions you didn't know to ask.

### Step 3: List Invariants + Constraints (5 min)

**Invariants** (what must be true):
1. ...
2. ...
3. (max 5)

**Constraints** (what cannot change):
1. ...
2. ...
3. (max 5)

### Step 4: Run a Pre-Mortem (10 min)

Assume this design failed in 6 months. Write the post-mortem:

> "In 6 months this is painful because..."
> 1. ...
> 2. ...
> 3. ...

Turn these into 3 design requirements or escape hatches.

### Step 5: Write an ADR Stub (5 min)

```
Problem: [1 sentence]
Options: [2-3 alternatives]
Criteria: [what matters for this decision]
Decision: [TBD or preliminary]
Consequences: [trade-offs accepted]
What would change my mind: [falsifiable condition]
```

Now you can propose structure with grounding.

---

## AI-Assisted Speculation Modes

Use AI as a scenario generator and critic, NOT as a proposer.

### Mode A: Question Generator

**Prompt Template**:
```
Given [component + constraints], list the top 20 questions whose answers
would change the design. Group by: usage, data, ops, security, scaling,
milestones.
```

**Output**: Checklist of uncertainties you might not have considered.

### Mode B: Red Team

**Prompt Template**:
```
Assume this design is wrong. Generate:
- 15 failure modes (how could this break?)
- 10 future requirements that would break this
Rank by likelihood × impact.
```

**Output**: Risk inventory to stress-test the design.

### Mode C: Concept Map Draft

**Prompt Template**:
```
Draft a concept map showing [entities, boundaries, owners, flows].
I'll validate with the team.
```

**Output**: Visual forcing function—diagrams reveal gaps in understanding.

### Mode D: Decision Matrix

**Prompt Template**:
```
Compare options [A, B, C] against criteria [list criteria].
What would make you switch from A to B?
What information would change the recommendation?
```

**Output**: Structured comparison with explicit switching conditions.

---

## Expert Mental Moves

When you "don't know what to look for," use these expert patterns:

### Widen → Then Narrow

1. Generate many plausible futures (10+)
2. Choose designs that survive the most likely ones
3. Document which futures would break the design

### Think in Time

| Timeframe | Question |
|-----------|----------|
| Now | What does it need to do today? |
| Next milestone | What's the next feature that will stress this? |
| 6 months | What changes? What stays stable? |
| 2 years | Is this still the right approach? |

### Model the System, Not the Code

Externalize:
- Concept maps (nouns + relationships)
- Data flow diagrams (where data moves)
- State diagrams (what states exist)

These reveal missing questions that code-level thinking obscures.

### Search for Invariants

Ask: "What must always be true?"
- Idempotency (can retry safely)
- Ordering (sequence matters)
- Ownership (one writer)
- Consistency (transaction boundaries)

### Identify Axes of Change

Common volatility axes in systems:
- Schema changes
- API versioning
- Storage backend changes
- Multi-tenant requirements
- Authentication/authorization
- Retry/failure handling
- Partial failure recovery

For each axis: "If this changes, how much breaks?"

### Pre-Mortem

> "Assume this design failed in 6 months—why?"

Forces adversarial thinking about your own proposal.

---

## Building Context-Sensitive Intuition

The gap isn't just technique—it's knowing what's good/bad in THIS specific project.

### Fast Ways to Import Project "Taste"

**Extract Decision Criteria**:
- What are the latency/SLO requirements?
- What's the deploy cadence?
- What's the data integrity tolerance?
- What observability is expected?
- What patterns are preferred/discouraged?

**Study Local Precedents**:
Find 3-5 similar components in THIS repo:
- How do they draw boundaries?
- How do they name things?
- How do they persist data?
- What patterns do they use?

**Read the Scars**:
- Past incidents and postmortems
- ADRs and decision records
- "Why we did X" comments
- TODO/FIXME with context

**Ask Context Packets**:
- "What's the next milestone that will hit this?"
- "What patterns are discouraged here?"
- "What's the last thing that broke like this?"

**Make Predictions and Calibrate**:
- "I expect X will be a problem when Y happens"
- Revisit later: Was I right? What did I miss?

---

## Expert Questions: Good Defaults

When you "don't know what to ask," start here:

### Usage Questions
- Who calls this?
- How often?
- Batch vs realtime?
- Sync vs async?
- Read-heavy vs write-heavy?

### Data Lifecycle Questions
- Who owns the data?
- Where is source of truth?
- Retention policy?
- Backfill strategy?
- Reprocessing story?

### Consistency Questions
- Transactions needed?
- Exactly-once semantics?
- Ordering requirements?
- Idempotency requirements?
- Concurrency handling?

### Operational Questions
- How do we debug this?
- What logs/metrics matter?
- What fails at 2am?
- What's the rollback story?
- What alerts are needed?

### Change Pressure Questions
- What's the next milestone that will stress this?
- What feature would "break" this structure?
- What's volatile? What's stable?

### Boundary Questions
- What should this component NOT do?
- What must remain swappable?
- What's the minimal interface?

---

## Related Documents

- [Principles](principles.md) - P1 (define job) and P2 (uncertainty) drive speculation
- [Mindset](mindset.md) - M2 (systems thinking) and M4 (invariants) are key habits
- [Effectiveness](effectiveness.md) - Speculation produces the "Evidence" and "Risks" fields
- [Planning](planning.md) - After speculation, use planning for task sequencing
