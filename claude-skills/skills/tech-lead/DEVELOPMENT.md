# Developing the Tech-Lead Skill

**Purpose**: Meta-documentation for evolving the skill itself—capturing design constraints, theoretical foundations, and development methodology.

---

## Section 1: Design Philosophy

### Generative Sequences Over Checklists

The skill explicitly rejects the pattern:

```
Situation → Checklist → Action
```

In favor of:

```
Principle → Recognition → Adaptive Response
```

**Why This Matters**:

| Approach | Characteristic | Example |
|----------|---------------|---------|
| **Checklist** | "if X, do Y" (deterministic, context-blind) | "Always add tests" |
| **Generative** | "given X, what does principle P imply?" (adaptive, context-sensitive) | "P5: How will we know it's broken?" |

Checklists tell you *what* to check. Principles tell you *how to think*. The goal is to internalize the thinking, not memorize the checks.

**Development Implications**:
- New content should teach *how to think*, not *what to check*
- Protocols should be generative (produce novel responses) not prescriptive (fixed steps)
- Each principle should have a "catch question" that generates context-appropriate actions
- Tripwires should trigger *recognition*, not mechanical rule-following

### Recognition Over Deliberation

Experts don't compare all options—they recognize patterns. This skill builds recognition through:
- Decision Tripwires (language cues that signal hidden decisions)
- Friction Signals (something's wrong indicators)
- Mental Simulation (M5 Operational Imagination)

**Goal**: "Notice" not "analyze"

### Worked Examples as Primary Teaching Tool

Abstract principles are insufficient for building intuition.

- [cases.md](cases.md) exists because seeing principle-in-action builds intuition
- Each principle in [principles.md](principles.md) includes worked examples
- **When adding new content**: Always include a concrete worked example

**Pattern**:
1. State the principle abstractly
2. Show what happens without it (failure case)
3. Show what happens with it (correct application)
4. Extract the transferable insight

---

## Section 2: Theoretical Foundation (Gary Klein)

### Recognition-Primed Decision (RPD) Model

Gary Klein's research on expert decision-making found that experts don't compare options—they recognize situations and mentally simulate a course of action.

**Three Levels of RPD**:

| Level | Description | Example in This Skill |
|-------|-------------|----------------------|
| **Level 1: Simple Match** | Recognize situation → Apply typical response | Language tripwire "I'll just..." → Surface hidden decision |
| **Level 2: Diagnose** | Recognize → Evaluate situation → Respond | Friction signal appears → Ask "What's the underlying issue?" |
| **Level 3: Mental Simulation** | Recognize → Imagine action playing out → Adjust | M5 2am Test: "How will this fail at 2am? How do we detect it?" |

### Critical Decision Method (CDM)

CDM is an interview technique for extracting tacit expert knowledge. Key probes:

| Probe | Purpose | Example |
|-------|---------|---------|
| "What did you notice?" | Surface recognition cues | "I noticed they said 'for now'—that's a commitment signal" |
| "How did you know?" | Extract pattern matching | "Similar code in three places usually means wrong abstraction level" |
| "What would a novice miss?" | Identify expertise gap | "Novice would just fix the error; expert asks why the error exists" |

### Mapping Klein's Concepts to This Skill

| Klein Concept | Skill Implementation |
|---------------|---------------------|
| Pattern recognition | Decision Tripwires, Friction Signals |
| Typicality | Case studies showing "recognizable" situations |
| Mental simulation | M5 Operational Imagination, "Cheat Sheet" step |
| Satisficing | "Safe default if proceeding now" |
| Cue learning | Classification Gym scenarios |
| Action scripts | Rituals (Start-of-task, Pre-merge) |

---

## Section 3: Development Workflow

### TDD with Classification Gym

The Classification Gym in [testing.md](testing.md) provides test scenarios for the skill.

**Red-Green-Refactor for Skills**:

1. **Red**: Write scenario that *should* be caught but isn't
   ```markdown
   ### Scenario X: [Name]
   **Input**: "[User message or code that should trigger recognition]"
   **Expected**: [What should be surfaced/caught]
   **Expert Cue**: [Which principle/tripwire should activate]
   ```

2. **Green**: Add tripwire/principle/protocol to catch it
   - Add to appropriate document ([principles.md](principles.md), [mindset.md](mindset.md), [SKILL.md](SKILL.md))
   - Ensure the scenario now passes

3. **Refactor**: Integrate with existing principles
   - Does this create redundancy?
   - Does this fit an existing principle's catch question?
   - Does this need a new case study?

**Example Development Cycle**:

```
Observation: Users saying "I'll handle errors later" aren't being caught
↓
Red: Write scenario for "I'll handle errors later"
  Input: "I'll add error handling later, let's get the happy path working first"
  Expected: Surface hidden decision about failure policy
  Expert Cue: Language tripwire + P5 (feedback loops)
↓
Green: Add to Language Tripwires table in SKILL.md
  "I'll handle X later" → Failure policy decision
↓
Refactor: Link to P5, add to cases.md if warranted
```

### Pattern Extraction from Real Sessions

Use CDM-style analysis to extract new patterns:

1. **Record**: Expert-junior session (conversation log, PR review, pair session)

2. **Probe**: Apply CDM questions
   - "What did the expert notice that the junior missed?"
   - "What triggered the expert's response?"
   - "What would have happened without intervention?"

3. **Abstract**: Convert to tripwire or friction signal
   ```markdown
   Cue observed: [What triggered expert recognition]
   Pattern: [Generalizable trigger]
   Principle: [Which P# or M# applies]
   Tripwire language: [Specific phrases to watch for]
   ```

4. **Test**: Add to Classification Gym

### Principle Refinement Cycle

When a miss pattern is observed repeatedly:

```
Observe repeated miss pattern
↓
Ask: "Which principle SHOULD have caught this?"
↓
┌─ None → Consider new principle (rare—should fit existing 7)
│         Ask: "Is this a genuinely distinct cognitive move?"
│         Ask: "Can I articulate a catch question?"
│
└─ Existing but not activated →
   - Is the catch question clear enough?
   - Do we need a new tripwire?
   - Do we need a worked example?
   - Add to Classification Gym for testing
```

---

## Section 4: Adding New Content

### When to Add New Principle

Adding a new principle (beyond the 7) should be rare. Requirements:

- [ ] Existing 7 don't cover the failure mode
- [ ] The cognitive move is genuinely distinct
- [ ] Can articulate a "catch question" that generates responses
- [ ] Has multiple real-world failure cases
- [ ] Integrates with existing principles without conflict

**If uncertain**: Extend an existing principle first.

### When to Extend Existing

More common than adding new principles:

- Failure fits existing principle but needs new tripwire
- Different context for same cognitive move
- New domain-specific application of general principle

**Extension checklist**:
- [ ] Add tripwire to existing principle's tripwire list
- [ ] Add worked example if context is novel
- [ ] Add case study to [cases.md](cases.md) if significant
- [ ] Update Classification Gym with new scenario

### Tripwire Design Guidelines

Tripwires are the primary recognition mechanism. Well-designed tripwires:

| Criterion | Description | Example |
|-----------|-------------|---------|
| **Observable** | Can be seen in language, action, or code | "I'll just..." in conversation |
| **Specific** | Precise enough to trigger reliably | "for now" (not "temporary intentions") |
| **Non-mechanical** | Triggers recognition, not robotic response | Causes pause, not automatic action |
| **Explained** | Includes "why it fails" explanation | "Signals commitment without analysis" |
| **Connected** | References principle it activates | Links to P7 (decision documentation) |

**Tripwire Template**:
```markdown
| Phrase Pattern | What It Signals | Principle |
|---------------|-----------------|-----------|
| "[exact language]" | [Hidden decision/commitment] | P# / M# |
```

### Case Study Format

Case studies in [cases.md](cases.md) follow a specific format:

```markdown
## CASE-XXX: Short Name

**Situation**: [Context when this happened]

**Hidden Decision**: [What decision was actually being made?]

**Tripwire Missed**: [What language cue or boundary-crossing action should have triggered recognition?]

**What Happened**: [What was done wrong]

**Decision Requirements** (what should have been established):
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **[what we're actually deciding]**"
- [Principle]: "[Question that would have revealed the issue]"
```

---

## Section 5: Quality Criteria

### Generativity Test

Ask: "Does this produce different responses in different contexts?"

| Pass | Fail |
|------|------|
| "P5: How will we know it's broken?" → Different answers for API vs batch job vs UI | "Always add logging" → Same action regardless of context |
| Catch question generates context-appropriate investigation | Numbered steps applied mechanically |

**If it fails**: Convert to principle with catch question, or remove.

### Recognition Test

Ask: "Can a developer 'notice' this without deliberate analysis?"

| Pass | Fail |
|------|------|
| Tripwire is in normal conversation/code flow | Requires special review mode to detect |
| Causes immediate "wait..." reaction | Only visible in retrospective analysis |

**If it fails**: Make tripwire more observable, or reduce to essential cue.

### Lightness Test

Ask: "Can rituals complete in stated time?"

| Ritual | Time Budget |
|--------|-------------|
| Start-of-task | 3 min |
| Pre-merge | 2 min |
| Decision Surfacing Loop | 1 min per decision |

**If adding content increases time beyond budget**: Extract essence, trust recognition, or make optional for advanced users.

### Integration Test

Ask: "Does this connect to existing principles?"

| Pass | Fail |
|------|------|
| New tripwire links to existing P# | Orphan concept without principle connection |
| Case study references multiple principles | Standalone rule with no integration |
| Strengthens existing pattern | Creates conflict with existing guidance |

**If it fails**: Find the connection, or question whether it belongs.

---

## Section 6: Anti-Patterns

### Checklist Creep

**Symptom**: "Always do X before Y" rules proliferate

**Example**:
```
Bad:  "Always check for existing patterns before creating new directory"
Good: "P6 catch question: 'Where does similar live?'"
```

**Fix**: Convert to principle with catch question. The principle should generate the check, not prescribe it.

### Over-Specification

**Symptom**: Protocol with 10+ steps

**Example**:
```
Bad:  Speculation Protocol with 15 substeps each having 3 sub-substeps
Good: 5 steps that trust the developer to fill in context-appropriate details
```

**Fix**: Extract essence, trust recognition. If developers need 10 steps, they haven't internalized the principle yet—add worked examples instead.

### Context-Free Rules

**Symptom**: "Never use X" / "Always use Y"

**Example**:
```
Bad:  "Never hardcode configuration values"
Good: "If hardcoding: What changes when this value changes? What's the blast radius?"
```

**Fix**: Add "When" and "Why not" to create context-sensitivity.

### Kitchen Sink Syndrome

**Symptom**: Adding every good idea encountered

**Test**: Apply Decision-ness filter to the skill itself:
- Does this address a repeated failure pattern?
- Is it distinct from existing content?
- Does it justify the cognitive load increase?

**Fix**: Maintain a "parking lot" for ideas. Only promote to skill when there's evidence of repeated need.

### Abstraction Without Cases

**Symptom**: New principle stated abstractly without worked examples

**Example**:
```
Bad:  "Practice epistemic hygiene by separating facts from assumptions"
Good: [mindset.md M1 section with concrete before/after examples]
```

**Fix**: No principle without at least one case study or worked example.

---

## Section 7: Evolution Guidelines

### Versioning Mindset

This skill is a living document. Evolution should be:
- **Additive** when possible (new tripwires, new cases)
- **Conservative** with principles (7 is intentional, not arbitrary)
- **Tested** via Classification Gym before deployment

### Change Log Practice

When making significant changes:
```markdown
## [Date]: [Change Summary]
- **Added**: [New tripwire/case/example]
- **Changed**: [Modified existing content]
- **Rationale**: [Why this change improves the skill]
- **Testing**: [Classification Gym scenarios affected]
```

### Feedback Integration

Sources of feedback for skill improvement:
1. **Session analysis**: CDM-style review of expert-junior sessions
2. **Classification Gym failures**: Scenarios that aren't caught
3. **User reports**: "This principle didn't help when..."
4. **Retrospectives**: "Which principle would have caught this?"

---

## Related Documents

- [SKILL.md](SKILL.md) - Main skill definition
- [testing.md](testing.md) - Classification Gym for skill validation
- [principles.md](principles.md) - The 7 core principles
- [mindset.md](mindset.md) - Foundational mental habits (M1-M7)
- [mindset-advanced.md](mindset-advanced.md) - Advanced mental habits (M8-M10)
- [naming.md](naming.md) - Expert naming strategies (supports M10)
- [cases.md](cases.md) - Central repository of worked examples
- [effectiveness.md](effectiveness.md) - Self-assessment without senior review
