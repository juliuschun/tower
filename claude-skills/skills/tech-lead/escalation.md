# Escalation Protocol

**Purpose**: Know when to decide autonomously vs. when to confirm with tech lead.

---

## Principle-Based Escalation

Escalation happens when a principle says "stop here":

| Principle | Escalation Signal |
|-----------|-------------------|
| **P1** (Define job) | Success criteria ambiguous or multiple interpretations |
| **P2** (Uncertainty) | Risk not quantified or impact severe |
| **P4** (Isolate volatility) | Irreversible decision required |
| **P6** (Consistency) | No existing pattern or new pattern needed |
| **P7** (Document decisions) | Architecture-level decision |

---

## Escalation Triggers

| Trigger | Principles | Signal | Say This |
|---------|------------|--------|----------|
| **Architecture impact** | P6, P7 | New top-level directory, module dependencies | "Architecture impact - need confirmation" |
| **New pattern** | P6 | Pattern not in codebase, could spread | "New pattern could spread - need confirmation" |
| **Core domain** | P3, P4 | Shared model/interface changes | "Core change - need confirmation" |
| **Multiple interpretations** | P1 | Requirements can be read different ways | "Ambiguous requirements - need clarification" |
| **Time vs quality** | P2, P4 | Urgent but quality concerns | "Trade-off decision - need priority call" |
| **Unquantified risk** | P2 | Failure probability/impact unclear | "Risk not quantified - need confirmation" |
| **Timebox exceeded without evidence** | M8, M9 | Timebox breached + no new evidence (tests, ruled-out hypotheses). Apply M9 Evidence Audit first. | "Timebox exceeded without progress - need guidance" |

---

## Autonomous Decisions (No Escalation)

| Situation | Why Autonomous |
|-----------|----------------|
| Following existing pattern exactly | P6 satisfied |
| Local change within single file | P4 satisfied (easy rollback) |
| Clear bug fix (no behavior change) | P1 satisfied (scope clear) |
| Adding tests (existing interface) | P5 satisfied (feedback loop) |
| Documentation/comments | Limited impact |
| Refactoring (same behavior) | P4 satisfied (easy rollback) |

---

## Decision Tree

```
Creating new structure/pattern?
├── Similar exists in codebase (P6)
│   └── Follow it, verify fit
└── Nothing similar
    └── ESCALATE: Need confirmation

Accepting workaround?
├── Failure mode quantified (P2)
│   └── Document and proceed
└── Unquantified or severe
    └── ESCALATE: Need confirmation

Feeling time pressure? (M6)
├── 30-second pause → "Should I step back?"
│   ├── Simple bug → Proceed
│   └── Architecture impact
│       └── ESCALATE: Need confirmation
```

---

## Escalation Format

```markdown
**Escalation**: [Trigger type]

**Principle**: [Which principle requires this escalation]

**Situation**: [What you're trying to do]

**Options**:
- A: [Option description]
- B: [Option description]

**My judgment**: [Which seems better and why]

**Uncertain about**: [What's unclear]

**Question**: [Specific thing to confirm]
```

---

## Trigger-Specific Questions

### Architecture Impact (P6, P7)

- Where does similar live? (P6)
- Is the dependency direction correct? (P4)
- Should I document this decision? (P7)

### New Pattern (P6)

- How does the codebase handle similar things?
- If others copy this pattern, would that be okay?
- Why doesn't an existing pattern work?

### Core Domain (P3, P4)

- How many places depend on this interface?
- What invariants might break? (P3)
- Is this reversible? (P4)

### Multiple Interpretations (P1)

- What's the success criteria?
- Do the interpretations have different non-goals?
- Which interpretation has the smallest scope?

### Time vs Quality (P2, P4)

- Is the deadline real or perceived?
- If we do it now and fix later, is rollback easy? (P4)
- Is the risk quantified? (P2)

---

## Good Escalation Example

```
**Escalation**: Architecture impact

**Principle**: P6 (Consistency) - existing pattern under data/, need to decide new location

**Situation**: Creating a new analytics module.

**Options**:
- A: Create analytics/ at top level
- B: Create data/analytics following data/ingestion pattern

**My judgment**: B seems better—consistent with existing data/ structure.

**Uncertain about**: Whether data/ is meant for all data-related modules or just ingestion.

**Question**: Should analytics go under data/?
```

---

## Bad Escalation Example

```
How should I do this?
```

**Problem**: No situation, options, judgment, uncertainty, or specific question.

---

## Effectiveness Contract and Escalation

When filling out the [Effectiveness Contract](effectiveness.md), escalation needs naturally surface:

| Contract Field | Escalation Signal |
|----------------|-------------------|
| **Outcome** | Multiple interpretations → P1 escalation |
| **Non-goals** | Unclear scope → P1 escalation |
| **Risks** | Can't quantify → P2 escalation |
| **Rollback** | Difficult to undo → P4 escalation |

---

## Related Documents

- [principles.md](principles.md) - Principle details
- [mindset.md](mindset.md) - M6 (Pace switching) and foundational habits M1-M7
- [mindset-advanced.md](mindset-advanced.md) - M8 (Execution awareness), M9 (Diagnostic reasoning), M10 (Naming)
- [effectiveness.md](effectiveness.md) - Effectiveness Contract, Execution Monitoring
- [SKILL.md](SKILL.md) - Skill overview
