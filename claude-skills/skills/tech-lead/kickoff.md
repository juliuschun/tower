# Project Kickoff: Decision Requirement Table

**Purpose**: At project/task start, generate a Decision Requirement Table before deep design. This proactively surfaces the decisions that will need to be made.

**Core Problem**: Junior developers often dive into implementation without recognizing the key decisions they'll face. This kickoff protocol forces early identification of decisions and their requirements.

---

## Kickoff vs Planning

| Aspect | Kickoff (this document) | Planning ([planning.md](planning.md)) |
|--------|------------------------|---------------------------------------|
| **Scope** | Project/initiative level | Task/milestone level |
| **Focus** | What decisions need to be made? | How do we sequence the work? |
| **Output** | Decision Requirement Table | Execution Plan with Tracer Bullet |
| **Timeframe** | Before design begins | Before implementation begins |
| **Duration** | 30-60 min | 15 min |

**Flow**: Kickoff → (for each milestone) → Planning Ritual

For task-level execution planning, see [planning.md](planning.md).

---

## Step 1: Context Sweep (5-10 min)

Before generating decisions, gather context on these dimensions:

### Context Checklist

| Dimension | Question | Notes |
|-----------|----------|-------|
| **Success metrics** | What does success look like? How will we measure it? | |
| **Non-goals** | What are we explicitly NOT doing? | |
| **Deadline** | What's the timeline? What's the MVP? | |
| **Team conventions** | What patterns/styles are expected here? | |
| **Deployment reality** | How does this get deployed? Who's on-call? | |
| **Data sensitivity** | Is there PII? Compliance requirements? | |
| **Scale expectations** | Current scale? Expected 10x scale? | |
| **Integration constraints** | What systems must this integrate with? | |

### Context Sweep Prompt

```
Before we start designing, let me understand the context:

1. What does success look like for this project/task?
2. What are we explicitly NOT doing (non-goals)?
3. What's the deployment/oncall reality?
4. Any data sensitivity or compliance concerns?
5. What's the expected scale (now and 10x)?
6. What existing systems/conventions must we follow?
```

---

## Step 2: Generate Likely Decision Set (8-15 decisions)

Based on the project type, generate the likely decisions. Use this as a starting point:

### Common Decision Categories

| Category | Example Decisions |
|----------|-------------------|
| **Boundaries/Modules** | Where does X live? Who owns it? What's the interface? |
| **Data Model** | What schema? What meaning? What migrations? |
| **Error/Failure Policy** | What do we do on failure? Retry? Fallback? Fail-loud? |
| **Rollout Strategy** | Feature flag? Gradual rollout? Migration path? |
| **Observability** | What metrics? What alerts? What logs? |
| **Caching/State** | Where does state live? What consistency guarantees? |
| **Dependencies** | What libraries? What are we locked into? |
| **Testing Strategy** | What level of coverage? What test types? |

### Decision Generation Prompt

```
Given this project context, generate 8-15 likely decisions we'll need to make:

For each decision, identify:
- What we're deciding
- Why it matters (stakes)
- What could go wrong if we get it wrong
```

---

## Step 3: Fill Decision Requirement Table

For each significant decision, fill out this table:

### Decision Requirement Table Template

| Decision | Stakes | Requirements (must/should) | Evidence Needed | Reversibility |
|----------|--------|---------------------------|-----------------|---------------|
| [What we're deciding] | [Why it matters] | [What must be true] | [How to validate] | [Easy/Medium/Hard] |

### Example: Adding User Authentication

| Decision | Stakes | Requirements (must/should) | Evidence Needed | Reversibility |
|----------|--------|---------------------------|-----------------|---------------|
| Where does auth logic live? | Affects who can modify, coupling | Must be isolated module; should follow existing patterns | Check existing structure | Easy if caught early |
| What session storage? | Performance, scalability, ops | Must survive restarts; should scale horizontally | Load test, ops review | Medium - migration needed |
| What failure policy? | User experience, security | Must fail closed (deny on error); should log attempts | Security review | Easy - config change |
| What token format? | Future integrations, security | Must be stateless (JWT); should have rotation plan | List 3 future integrations | Hard - client changes |

### Requirements Format

Use these prefixes:
- **Must**: Non-negotiable requirement
- **Should**: Strong preference, can be overridden with justification
- **Could**: Nice to have, low priority

---

## Step 4: Identify Decision Dependencies

Some decisions depend on others. Map the dependencies:

```
Example dependency chain:
1. "What data model?" → 2. "Where does state live?"
   ↓
3. "What consistency guarantees?"
   ↓
4. "What failure policy?"
```

### Dependency Mapping Template

| Decision | Depends On | Blocks |
|----------|------------|--------|
| What data model? | Context sweep | State location, schema design |
| What failure policy? | Data model, state location | Observability design |
| What rollout strategy? | Feature scope | Testing strategy |

---

## Step 5: Prioritize for Early Resolution

Decisions that are:
- Hard to reverse
- Block other decisions
- High stakes

...should be resolved first.

### Priority Matrix

| Decision | Reversibility | Blocking? | Stakes | Priority |
|----------|---------------|-----------|--------|----------|
| Data model | Hard | Yes | High | **Resolve First** |
| Failure policy | Medium | Yes | High | **Resolve Second** |
| Module location | Easy | No | Medium | Resolve Third |
| Logging format | Easy | No | Low | Defer |

---

## Kickoff Output Template

After completing the kickoff, produce this summary:

```markdown
## Project Kickoff Summary: [Project Name]

### Context
- **Success metrics**: [1-2 sentences]
- **Non-goals**: [bullet list]
- **Key constraints**: [bullet list]

### Decision Requirement Table

| Decision | Stakes | Requirements | Evidence Needed | Priority |
|----------|--------|--------------|-----------------|----------|
| [Decision 1] | [Stakes] | Must: X; Should: Y | [Evidence] | [1-5] |
| [Decision 2] | [Stakes] | Must: X; Should: Y | [Evidence] | [1-5] |
| ... | ... | ... | ... | ... |

### Decision Dependencies
- [Decision A] blocks [Decision B]
- [Decision C] depends on [Decision D]

### Immediate Actions
1. [Resolve Decision 1 first because...]
2. [Gather evidence for Decision 2 by...]
3. [Schedule discussion for Decision 3 because...]
```

---

## Quick Kickoff (3 min)

For smaller tasks, use this abbreviated version:

1. **What are we deciding?** (List 3-5 decisions)
2. **What must be true?** (1-2 requirements each)
3. **What's hardest to reverse?** (Resolve that first)

### Quick Kickoff Prompt

```
Before starting this task:
1. What are the 3-5 decisions I'll need to make?
2. For each: What must be true? (1-2 requirements)
3. Which is hardest to reverse? (Start there)
```

---

## Integration with Other Documents

- **Speculation Protocol**: The Decision Requirement Table is the output of speculation
- **Principles**: Each decision should be evaluated against relevant principles (P1-P7)
- **Effectiveness Contract**: Decisions feed into the "Risks" and "Rollback" fields
- **ADRs**: Significant decisions from the table become ADR candidates

---

## Related Documents

- [SKILL.md](SKILL.md) - Decision Tripwires and Surfacing Loop
- [planning.md](planning.md) - 15-Minute Planning Ritual for task execution
- [speculation.md](speculation.md) - Deep understanding before proposing
- [principles.md](principles.md) - P7: Write down the decision
- [effectiveness.md](effectiveness.md) - Effectiveness Contract
