# Testing: Classification Gym

**Purpose**: Test decision surfacing effectiveness with concrete scenarios. For skill development and validation, not end-user documentation.

**Usage**: Use TDD-style testing per [DEVELOPMENT.md](DEVELOPMENT.md). Write failing scenario → add tripwire/principle → verify scenario passes.

---

## Scenario Index

| # | Name | Tests | Key Mindset/Principle |
|---|------|-------|----------------------|
| 1 | Language Tripwire Detection | Hidden commitment cues | M7 (Decision awareness) |
| 2 | Boundary-Crossing Action | Structure decisions | P6 (Consistency) |
| 3 | Meta-Question Tripwire | Proxy questions | P1 (Define the job) |
| 4 | Urgent Fix Mode | Failure policy under pressure | M6 (Pace switching), P5 |
| 5 | Project Kickoff | Decision Requirement Table | kickoff.md protocol |
| 6 | The Rabbit Hole | Execution drift | [M8](mindset-advanced.md#m8-execution-awareness) (Execution awareness) |
| 7 | Hypothesis Testing | Diagnostic methodology | [M9](mindset-advanced.md#m9-diagnostic-reasoning) (Diagnostic reasoning) |
| 8 | Silent Failure | Data quality vs job success | [M9](mindset-advanced.md#m9-diagnostic-reasoning) + M5 |
| 9 | Non-Reproducible Bug | Production debugging | [M9](mindset-advanced.md#m9-diagnostic-reasoning) (Observability strategy) |
| 10 | Implementation Name Leak | External vocabulary in config | [M10](mindset-advanced.md#m10-mental-model-alignment) (Mental model alignment) |
| 11 | Generic Module Name | Boundary-definition failure | [M10](mindset-advanced.md#m10-mental-model-alignment) (Mental model alignment) |
| 12 | Ambiguous Boolean | State-transition naming | [M10](mindset-advanced.md#m10-mental-model-alignment) (Mental model alignment) |
| 13 | Skip-Reading Test Failure | Generic function name | [M10](mindset-advanced.md#m10-mental-model-alignment) (Mental model alignment) |

---

## Scenarios

### Scenario 1: Language Tripwire Detection
**Input**: "I'll just put this helper function in utils for now"
**Expected**: Surface hidden decision about module placement and shared code ownership
**Expert Cue**: Decision Callout with "Where does X live?" framing

---

### Scenario 2: Boundary-Crossing Action
**Input**: "Let me create a new `shared/` directory for common types"
**Expected**: Surface hidden decision about directory structure contract and precedent
**Expert Cue**: P6 check ("Where does similar live?") + escalation trigger

---

### Scenario 3: Meta-Question Tripwire
**Input**: "What's the correct practice for implementing a facade pattern?"
**Expected**: Probe for actual decision requirements (volatility, failure semantics, boundaries)
**Expert Cue**: Convert to "What are we actually deciding?" before answering

---

### Scenario 4: Urgent Fix Mode
**Input**: "Quick fix needed - just catch this exception and log it"
**Expected**: Surface hidden decision about failure policy
**Expert Cue**: M6 pace switching + P5 feedback loop check

---

### Scenario 5: Project Kickoff
**Input**: "Let's add user authentication to the app"
**Expected**: Generate Decision Requirement Table proactively
**Expert Cue**: kickoff.md protocol with 8-15 likely decisions

---

### Scenario 6: The Rabbit Hole (M8)

**Input**: Time-stamped work log
```
09:00 - Task: Fix upload bug (files >10MB fail). Timebox: 2 hours.
09:30 - "Found the issue might be in chunking. Let me refactor the uploader first so it's easier to debug."
10:30 - "Refactor taking longer than expected. Almost done."
11:00 - "While I'm here, noticed the retry logic is messy. Let me clean that up."
11:30 - "One more try on the chunking. I think I'm 90% there."
12:00 - "Still debugging. Maybe it's a timeout issue... let me try increasing that."
```

**Expected Recognition**:
- 09:30: Scope creep ("refactor first") - M8 tripwire
- 10:30: Progress illusion ("Almost done" + "longer than expected") - M8 tripwire
- 11:00: Magpie ("While I'm here") - M8 tripwire
- 11:30: Zeno's Paradox ("90% there" after "almost done") - M8 tripwire
- 12:00: Timebox breach + unstructured search ("Maybe it's...") - M8 + escalation

**Correct Response**:
- At 09:30: "Is refactor in my Outcome? No. Defer or timebox separately."
- At 11:00: "Timebox exceeded. What evidence do I have? None on original bug. Escalate or revert and narrow scope."

---

### Scenario 7: Hypothesis Testing (M9)
**Input**: "Response times slow. Could be database, network, or memory."
**Expected**: Design smallest test to isolate layer—not "check everything"
**Expert Cue**: Binary search strategy + falsifiable prediction before each test

**Correct Response**:
- "I'll measure database query time directly. If >100ms, database is the bottleneck. If <10ms, look elsewhere."
- NOT: "Let me check the database... now let me check network... now let me check memory..."

---

### Scenario 8: Silent Failure (M9 + M5)
**Input**: "Nightly job runs without errors but reports dropped 40%"
**Expected**: Recognize data quality vs job success distinction
**Expert Cue**: M5 question: "How would we have known this broke?"

**Correct Response**:
- "Job success ≠ correct output. Where's the data quality check?"
- "When did the drop start? What changed in the data source around that time?"
- NOT: "The job logs show no errors, so the job is working fine."

---

### Scenario 9: Non-Reproducible Bug (M9)
**Input**: "Bug happens 1 in 1000 requests. Can't reproduce locally."
**Expected**: Logging/monitoring strategy, not local debugging
**Expert Cue**: Production-specific diagnostic approach—observability over reproduction

**Correct Response**:
- "Add structured logging to capture state when failure occurs. Correlate with metrics (load, time, request characteristics)."
- "Look for patterns: Same user? Same data? Same time window? Same request path?"
- NOT: "Let me try to reproduce it by sending 1000 requests locally."

---

### Scenario 10: Implementation Name Leak (M10)

**Input**: "I'll name the config key `kafka.bootstrap.servers` since that's what Kafka calls it"

**Expected**: Detect external vocabulary leak - M10 tripwire

**Expert Cue**: "Name for what caller needs (messaging connection), not how you provide it (Kafka)"

**Correct Response**:
- "Consider `messaging.connection.servers` - survives if you switch to RabbitMQ or any other message broker"
- "The caller needs messaging, not Kafka specifically. What name would still make sense with a different provider?"
- NOT: "That's fine, it's clear what it refers to"

---

### Scenario 11: Generic Module Name (M10)

**Input**: "I'll put these helper functions in a new `utils` package"

**Expected**: Detect boundary-definition failure - M10 tripwire

**Expert Cue**: "What would make someone HESITATE to add unrelated code?"

**Correct Response**:
- "What do these helpers have in common? `customerDataTransforms` creates a boundary; `utils` is a dumping ground"
- "In 6 months, `utils` will have 30 unrelated functions. What name would make someone pause before adding date formatting next to payment validation?"
- NOT: "That's a reasonable place to put shared code"

---

### Scenario 12: Ambiguous Boolean (M10)

**Input**: "Add a boolean field `processed` to track if we've handled the order"

**Expected**: Detect ambiguous state naming - M10 tripwire

**Expert Cue**: "If this boolean is false, what HAPPENED?"

**Correct Response**:
- "Name the state transition: `has_completed_fulfillment` or `is_awaiting_shipment`"
- "If `processed` is false, does that mean: not yet started? in progress? failed? rejected? The name should make this clear"
- NOT: "That accurately describes the state"

---

### Scenario 13: Skip-Reading Test Failure (M10)

**Input**: "I'll call this function `handleData`"

**Expected**: Detect generic name that fails skip-reading test

**Expert Cue**: "Can I understand this WITHOUT reading the code?"

**Correct Response**:
- "What does it actually DO? `validateAndRouteCustomerOrder` tells the story"
- "`handleData` could mean anything - transform, validate, persist, forward. What would let someone understand its purpose from the name alone?"
- NOT: "That's a reasonable name for a data handler"

---

## Scoring Rubrics

### General Decision Surfacing Rubric

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| Tripwire Detection | Missed | Partial | Most caught | All caught |
| Decision Naming | Not named | Vague | Clear | Precise + stakes |
| Requirements | None | Generic | Context-aware | Falsifiable |
| Safe Default | None | Mentioned | Actionable | Reversible + hook |

### M8 Execution Awareness Rubric (Scenario 6)

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| Tripwire Detection | Missed all | Caught 1-2 | Caught 3-4 | All + types named |
| Evidence Assessment | None | Vague | Listed evidence gaps | Quantified (0 tests, 0 hypotheses ruled out) |
| Correct Action | Continued | Paused but no plan | Paused + new timebox | Escalate/revert + evidence-based next step |

### M9 Diagnostic Reasoning Rubric (Scenarios 7-9)

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| Strategy Selection | Wrong approach for situation | Partially appropriate | Correct strategy | Strategy + reasoning |
| Hypothesis Formation | No hypothesis | Vague hypothesis | Clear hypothesis | Falsifiable prediction |
| Evidence Tracking | None | Mentioned | Structured | Ruled-out list maintained |
| Isolation Technique | Shotgun approach | Some isolation | Binary search | Minimum viable test |

### M10 Mental Model Alignment Rubric (Scenarios 10-13)

| Dimension | 0 | 1 | 2 | 3 |
|-----------|---|---|---|---|
| Tripwire Detection | Missed naming issue | Partial recognition | Issue identified | Issue + strategy named |
| Reader Simulation | No reader consideration | Vague "clarity" mention | Specific reader identified | Reader's mental model articulated |
| Alternative Suggestion | None | Generic improvement | Context-aware name | Name + reasoning for choice |
| Strategy Application | No strategy | Wrong strategy for artifact | Correct strategy | Strategy matched to artifact type |

---

## Adding New Scenarios

When adding a new test scenario, follow this template:

```markdown
### Scenario N: [Name]
**Input**: "[User message or situation that should trigger recognition]"
**Expected**: [What behavior/output the skill should produce]
**Expert Cue**: [Which principle/tripwire should activate]

**Correct Response**:
- [What good looks like]
- NOT: [What bad looks like]
```

After adding:
1. Verify the scenario fails without the corresponding tripwire/principle
2. Add the tripwire/principle to the appropriate document
3. Verify the scenario now passes
4. Update the Scenario Index table above

---

## Related Documents

- [DEVELOPMENT.md](DEVELOPMENT.md) - TDD workflow for skill development
- [SKILL.md](SKILL.md) - Main skill definition
- [cases.md](cases.md) - Worked examples (for user documentation, not testing)
