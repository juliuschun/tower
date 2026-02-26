# Planning Under Uncertainty

**Purpose**: Transform planning from task-listing into uncertainty-surfacing. Plans should be structured around **what we don't know**, not what we'll do.

**Core Insight**: Juniors plan by listing *tasks*. Experts plan by identifying *unknowns* and sequencing work to **buy information cheapest/fastest**.

---

## The Planning Anti-Patterns

Juniors fail at planning in predictable ways:

| Anti-Pattern | What It Looks Like |
|--------------|-------------------|
| Random info gathering → optimistic Gantt-chart | Surprises pile up at the end |
| Ambiguous milestone lists | "Build user module" with no definition of done |
| Skip vivid end-state vision | Dive into "what they'll do" without knowing "what done looks like" |
| Don't understand system as whole | No gap analysis between current and desired state |
| Treat unknowns as afterthoughts | Risk section buried at bottom of document |
| Linear task sequences | Don't acknowledge learning dependencies |

---

## Expert Mental Models

| Mental Model | Junior Behavior | Expert Behavior |
|--------------|-----------------|-----------------|
| **Outcomes over Output** | "I wrote the migration script" | "Data is safely in new table" |
| **Cone of Uncertainty** | Detailed 4-week plan upfront | Detailed Week 1 + loose outline rest |
| **Learning Dependencies** | "Need DB to write API" (logical) | "Need to know if DB is fast enough" (risk-based) |
| **Working Backwards** | Start with Step 1 | Start with final PR description |
| **Simulate to Decide** | Plan abstractly | Write "cheat sheet" code that forces decisions |

### The Core Shift

> **Plans are structured around WHAT WE DON'T KNOW, not what we'll do.**

Milestones should be "unknown → known" transitions, not task completions.

---

## 15-Minute Planning Ritual

Use this ritual for any task that will take more than 2 days.

### Step 1: Vivid End State (3 min)

**Principle**: P1 (Define the job and the edges)

**Cognitive Move**: Work backwards from outcome.

Instead of "Implement X", write the **Final PR Description**:
- What exactly works? (Not "user can login" but "user hits /login, gets JWT, redirects to /dashboard")
- What does "Done" look like? (Screenshots, logs, metrics)
- What is explicitly NOT done? (Non-goals)

**Tripwire**: If you can't describe the end state vividly, you don't know what you're building.

**Template**:
```markdown
## Final PR Description (Draft)

### What Works
- User does X, system responds with Y
- API returns Z format with fields A, B, C
- Dashboard shows metric at <200ms latency

### Definition of Done
- [ ] Tests pass for happy path
- [ ] Error states handled: [list]
- [ ] Logs show: [what to look for]

### Non-Goals (Explicitly Not Done)
- No mobile support yet
- No internationalization
- Not optimized for >1000 concurrent users
```

---

### Step 2: The Cheat Sheet (3 min)

**Principle**: P3 (Make meaning explicit)

**Cognitive Move**: Simulate reality to force decisions (Readme-Driven Development).

Write the code you *wish* you had:
- Final API call: `const result = await processData(input)`
- CLI command: `./run-job --input X --output Y`
- Database schema (draft)

**Why**: Forces decisions about inputs, outputs, names NOW—exposes gaps before implementation.

**Template**:
```markdown
## Interface Cheat Sheet

### API Shape
```typescript
// What I wish I could call
const user = await auth.login(email, password)
// Returns: { token: string, expiresAt: Date, user: User }

const data = await api.fetchDashboard(userId, timeRange)
// Returns: { metrics: Metric[], lastUpdated: Date }
```

### CLI (if applicable)
```bash
./tool --input data.csv --output results.json --verbose
```

### Schema (draft)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  -- What else? (Forces you to decide)
);
```
```

---

### Step 3: Uncertainty Audit (5 min)

**Principle**: P2 (Treat uncertainty as the real work)

**Cognitive Move**: List everything you're *pretending* to know.

| Category | Item | Risk Level |
|----------|------|------------|
| **Assumption** | Things you believe are true but haven't verified | Low-Medium |
| **Known Unknown** | Questions you know you need to answer | Medium |
| **Scary Unknown** | Things that could derail the project | **High** |

**Ranking Rule**: The thing that scares you most is Priority #1.

**Template**:
```markdown
## Uncertainty Audit

### Assumptions (Believed but not verified)
| Assumption | Risk | How to verify |
|------------|------|---------------|
| "The API returns JSON" | Low | Check docs / test call |
| "Users have unique emails" | Medium | Check DB constraints |

### Known Unknowns (Questions to answer)
| Unknown | Risk | Plan to resolve |
|---------|------|-----------------|
| "How to handle auth retries" | Medium | Spike in M0 |
| "What error codes does API return?" | Medium | Read docs + test |

### Scary Unknowns (Could derail project)
| Unknown | Risk | Validation approach |
|---------|------|---------------------|
| "Can legacy DB handle this load?" | **High** | Load test Tracer Bullet |
| "Will third-party API rate limit us?" | **High** | Spike with realistic volume |
```

---

### Step 4: Tracer Bullet (4 min)

**Principle**: P5 (Short, truthful feedback loops)

**Cognitive Move**: Optimize for learning, not completing tasks.

Define Milestone 0 as a **Thread** through the system:
- **Goal**: Validate the *Scary Unknown* from Step 3
- **Form**: "Hello World" that touches all layers (FE → BE → DB → FE)
- **Quality**: Hardcoded, ugly, but *connected*

**The Rule**: Not allowed to build "Feature A" until Tracer Bullet confirms path is clear.

**Template**:
```markdown
## Tracer Bullet (M0)

### Goal
Validate: [Scary Unknown from Step 3]

### Implementation
- FE: Button that triggers API call
- BE: Endpoint that queries DB and returns hardcoded response
- DB: Single row of test data

### What It Proves
- [ ] Connection path FE→BE→DB works
- [ ] Auth/permissions don't block us
- [ ] Response time is acceptable (<Xms)

### What It Doesn't Prove (Yet)
- Real data transformation
- Error handling
- Edge cases
```

---

## Planning Tripwires

These are "bad smells" in plans. When you see them, apply the correction.

| Tripwire | Why It Fails | Correction |
|----------|--------------|------------|
| **Integration Cliff** | "Connect FE/BE in Week 4" | Integrate Day 1 (Tracer Bullet) |
| **Research Task** | "Day 1-3: Research options" (no outcome) | Timebox: "4h: Build 2 prototypes. Pick one." |
| **Linear Logic** | "DB → API → UI" (horizontal layers) | Vertical slices: "User sees list (hardcoded) → (real DB)" |
| **Risk at End** | "Load test final week" | Shift left: Load test Tracer Bullet Week 1 |
| **TBDs in Critical Path** | "Auth (TBD)" in middle of plan | Resolve now—can't plan around black hole |
| **No Definition of Done** | "Build user module" | Observable outcome: "User can X, system shows Y" |
| **Optimistic Dependencies** | "After API is ready, we'll..." | What if API isn't ready? What's Plan B? |

### Detecting Tripwires

When reviewing a plan, ask:
1. **When do FE and BE first talk?** (If >Day 3, Integration Cliff)
2. **What's the first observable outcome?** (If vague, No Definition of Done)
3. **Where are the unknowns addressed?** (If Week 4, Risk at End)
4. **Are research tasks timeboxed with deliverables?** (If not, Research Task)
5. **Can each milestone be demoed?** (If not, Ambiguous Milestone)

---

## Execution Plan Template

Use this template for tasks > 2 days. It expands the Effectiveness Contract.

```markdown
# Execution Plan: [Feature Name]

## 1. Vivid End State (The Outcome)
- User does X, sees Y
- Metrics: Latency < 200ms, Error rate < 0.1%
- Non-Goal: No mobile support yet

## 2. The Cheat Sheet (Interface Draft)
```typescript
function process(data: Input): Result
```
```bash
./tool --input X --output Y
```

## 3. Uncertainty Audit (Risks)
| Unknown | Risk | Validation Plan |
|---------|------|-----------------|
| Third-party API rate limits? | High | Spike in M0 |
| Data migration downtime? | Medium | Test on staging |

## 4. Milestones (Vertical Slices)
- **M0 (Tracer)**: Hardcoded success path. Validates connection. (validates Risk #1)
- **M1 (Core)**: Happy path with real DB.
- **M2 (Edge)**: Error handling, retries.
- **M3 (Polish)**: CSS, logging, metrics.

## 5. Immediate Next Step
- Spike the API connection (verify Risk #1)

## 6. Decision Requirements
| Decision | Evidence Needed | Reversibility |
|----------|-----------------|---------------|
| Which auth library? | Security review | Medium |
| Cache strategy? | Load test results | Hard |
```

---

## Task Sequencing: Structure-Preserving Transformations

After planning milestones, sequence individual tasks wisely.

### The Problem

Juniors often:
1. Pick subtask ORDER based on "easy" or "obvious"
2. Make subtasks too BIG or too SMALL
3. Miss that some tasks CREATE OPTIONS while others CONSUME OPTIONS
4. Don't see how early decisions constrain later choices

### Three Perspectives on Sequencing

**Alexander (Structure-Preserving Transformation)**:
- A "good next step" strengthens the existing whole
- Prefer steps that increase wholeness NOW and make future steps easier
- Keep the system "alive": runnable, understandable, extensible

**Beck (Tidy First?)**:
- Separate "tidying" (structural change) from "behavior change"
- Tidy FIRST when it makes behavior change cheaper/safer
- Tidy AFTER when you learned what needed to be true

**Cunningham (Technical Debt)**:
- Use "principal + interest" to order work
- Pay down debt when: interest is high, you're building on top, it blocks learning

### Sequencing Heuristics

**What to do FIRST**:
- Create fast feedback (tests, observability) before big edits
- Attack biggest uncertainty early, but REVERSIBLY (spike, adapter, flag)
- Create seams/boundaries that allow incremental work

**How BIG each step should be**:
- Coherent intent (one clear purpose)
- Verifiable check (can confirm it worked)
- Reversible rollback (can undo if wrong)
- Bounded scope (doesn't sprawl)

**CREATE vs CONSUME optionality**:

| Creates Options | Consumes Options |
|-----------------|------------------|
| Adds tests/telemetry | Commits to schema/API |
| Reduces coupling | Removes old path |
| Introduces adapter/flag | Introduces global coupling |
| Keeps old path working | Irreversible migrations |

**Rule**: Before consuming options, ensure you have evidence + a hedge.

### Step Output Schema

```
Step: [imperative verb phrase]
  Type: tidy | feature | spike
  Option impact: creates | consumes | neutral
  Verify: [exact check]
  Rollback: [exact undo]
  Stop when: [condition]
```

---

## Integration with Principles

| Protocol Step | Principles | Why |
|---------------|------------|-----|
| Vivid End State | P1 (Define job) | Forces success criteria |
| Cheat Sheet | P3 (Make meaning explicit) | Forces interface contracts |
| Uncertainty Audit | P2 (Uncertainty as work) | Surfaces hidden risks |
| Tracer Bullet | P5 (Short feedback loops) | Gets feedback Day 1 |
| Vertical Slices | P4 (Isolate volatility) | Reversible sequence |
| Task Sequencing | P4 (Isolate volatility) | Creates options before consuming |

---

## Integration with Decision Requirement Table

The Uncertainty Audit feeds directly into [kickoff.md](kickoff.md)'s Decision Requirement Table:

```
Uncertainty Audit → "Scary Unknown: Can DB handle load?"
                  ↓
Decision Requirement Table → "Decision: Database choice"
                           → "Evidence Needed: Load test Tracer Bullet"
                           → "Reversibility: Hard - requires migration"
```

### When to Use Which

| Situation | Use |
|-----------|-----|
| **Project start** (new initiative, many unknowns) | [kickoff.md](kickoff.md) - Decision Requirement Table |
| **Task planning** (known scope, execution focus) | planning.md - 15-Minute Ritual |
| **Both** (large feature with strategic + tactical concerns) | Kickoff first, then Planning Ritual for each milestone |

---

## Behavioral Changes

### Should Increase
- Questions before coding
- Early integration/prototypes
- Explicit uncertainty tracking
- Vertical slice thinking
- "What's the scariest unknown?" framing

### Should Decrease
- Linear task lists
- Detailed long-term plans
- "Research X" as unbounded tasks
- Integration at the end
- Optimism bias

---

## Testing: Classification Gym

Test planning effectiveness with these scenarios:

### Scenario 1: Gantt-Chart Plan
**Input**: "Here's my plan: Week 1 - Setup, Week 2 - Backend, Week 3 - Frontend, Week 4 - Testing"
**Expected**: Detect Linear Logic + Risk at End tripwires
**Correction**: "What's your Tracer Bullet? When do FE/BE integrate?"

### Scenario 2: Ambiguous Milestone
**Input**: "Milestone 1: Build user authentication"
**Expected**: Detect No Definition of Done tripwire
**Correction**: "What does 'done' look like? User can X, system shows Y?"

### Scenario 3: Research Task
**Input**: "First I'll spend 3 days researching the best approach"
**Expected**: Detect Research Task tripwire
**Correction**: "Timebox it: 4h to build 2 prototypes, then pick one"

### Scenario 4: Good Plan
**Input**: "M0: Hardcoded login flow touching all layers. M1: Real auth. Biggest unknown: OAuth callback handling"
**Expected**: Recognize Tracer Bullet + Uncertainty-first structure
**Response**: Approve, suggest validation approach for OAuth unknown

### Scoring Rubric

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| Tripwire Detection | Missed | Partial | Most caught | All caught |
| End State Clarity | Vague | Some detail | Clear | Vivid + testable |
| Uncertainty Tracking | None | Listed | Ranked | Validated |
| Vertical Slices | Horizontal layers | Mixed | Mostly vertical | All vertical |

---

## Related Documents

- [SKILL.md](SKILL.md) - Core principles and decision tripwires
- [kickoff.md](kickoff.md) - Project kickoff with Decision Requirement Table
- [effectiveness.md](effectiveness.md) - Effectiveness Contract (shorter form)
- [principles.md](principles.md) - Full principle details
- [speculation.md](speculation.md) - Deep understanding before proposing
