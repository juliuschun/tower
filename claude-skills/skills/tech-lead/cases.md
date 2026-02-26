# Case Studies

Central repository of worked examples. Other documents link here.

## Case Index

| ID | Name | Hidden Decision | Tripwire Missed |
|----|------|-----------------|-----------------|
| [CASE-RESOLVER](#case-resolver-proposals-without-understanding) | Proposals without understanding | Where should this module live? | "put it here" without usage analysis |
| [CASE-STRUCTURE](#case-structure-module-in-wrong-location) | Module in wrong location | What's the directory structure contract? | "I'll just create..." new directory |
| [CASE-ID](#case-id-temporary-without-quantification) | Temporary without quantification | What ID collision policy are we accepting? | "temporary", "for now" |
| [CASE-NAMING](#case-naming-implementation-detail-in-names) | Implementation detail in names | What abstraction boundary are we creating? | "quick fix" under pressure |
| [CASE-NAMING-API](#case-naming-api-external-vocabulary-leak) | External vocabulary leak | What vocabulary are we committing to publicly? | "Same as the library calls it" |
| [CASE-NAMING-DATA](#case-naming-data-ambiguous-boolean) | Ambiguous boolean field | What state transition does this represent? | Ambiguous boolean name |
| [CASE-NAMING-MODULE](#case-naming-module-premature-abstraction) | Premature abstraction name | What boundary are we creating? | "Utils/Helpers" naming |
| [CASE-MIGRATION](#case-migration-fallback-to-deprecated-system) | Fallback to deprecated system | What's our failure policy during migration? | "good enough for now" |
| [CASE-PATTERN](#case-pattern-wrong-pattern-for-component) | Wrong pattern for component | What component lifecycle are we committing to? | "I'll just use this pattern" |
| [CASE-OPS](#case-ops-missing-operational-imagination) | Missing operational imagination | What failure detection contract are we accepting? | "it works" without ops thinking |
| [CASE-RABBITHOLE](#case-rabbithole-execution-drift) | Execution drift | When should I stop and reassess? | Scope creep + progress illusion + sunk cost |

---

## CASE-RESOLVER: Proposals Without Understanding

**Situation**: Asked "Is this module structure right?" about a resolver concept.

**Hidden Decision**: Where should this module live? What ownership boundaries are we creating?

**Tripwire Missed**: The question "Is this structure right?" is a meta-question tripwire—it's asking about placement without first defining what the module does and who uses it.

**What Happened**: Immediately proposed 3 structural options without first understanding:
- Current and future usage patterns
- Why certain naming conventions existed
- Concept definitions and boundaries

**Feedback**: "I can't tell without examining current/future usage patterns one by one." (Korean original: "현재/미래 사용패턴을 하나씩 뜯어본게 아니라서 이것만 봐서는 잘 모르겠어요")

**Decision Requirements** (what should have been established):
- Must understand 3+ current usage patterns before proposing location
- Must identify who owns the concept (storage? domain? shared?)
- Must check existing conventions for similar modules

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **where this module lives**"
- P1: "What are the usage patterns before proposing structure?"
- Speculation Protocol Step 1: Enumerate 10 usage patterns before proposing

---

## CASE-STRUCTURE: Module in Wrong Location

**Situation**: Creating a new domain module.

**Hidden Decision**: What's the directory structure contract? Where do new modules belong?

**Tripwire Missed**: "I'll just create a new directory" is a boundary-crossing action—creating a new top-level directory sets a precedent.

**What Happened**: Created `domain/` at project root without checking that similar modules exist under `data/`.

**Decision Requirements** (what should have been established):
- Must check existing directory structure before creating top-level
- Must verify new location is consistent with similar modules
- Must consider: will others copy this pattern?

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **where new modules live**"
- P6: "Where does similar live?" → `ls data/` first

---

## CASE-ID: Temporary Without Quantification

**Situation**: Needed unique IDs without database.

**Hidden Decision**: What ID collision policy are we accepting? What's the blast radius of failure?

**Tripwire Missed**: "TEMPORARY SOLUTION" comment is a code smell tripwire—it signals a decision was made without quantifying risk or setting a deadline.

**What Happened**: Used `hashCode` with comment "TEMPORARY SOLUTION" but:
- No collision probability calculated
- No timeline for replacement
- No blast radius analysis

**Decision Requirements** (what should have been established):
- Must quantify collision probability at current and 10x scale
- Must define blast radius: what breaks if collision occurs?
- Must set deadline or trigger for replacement

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what failure rate is acceptable**"
- P2: "What's the collision probability at 10x scale?"
- P2: "What's the blast radius if collision occurs?"

---

## CASE-NAMING: Implementation Detail in Names

**Situation**: Naming config namespace for S3-compatible storage.

**Hidden Decision**: What abstraction boundary are we creating? What volatility are we isolating?

**Tripwire Missed**: "quick fix" under pressure—urgency led to naming based on current implementation rather than stable concept.

**What Happened**: Named it `storage.minio` because local dev uses MinIO, but production uses actual S3.

**Problem**: Name exposes implementation detail; breaks when backend changes.

**Decision Requirements** (what should have been established):
- Must name at abstraction level, not implementation level
- Must survive backend changes
- Must consider: if we change storage provider, does this name still make sense?

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what abstraction boundary to create**"
- P4: "If we change backend, is this name still true?"
- Better: `storage.objectStorage` or `storage.s3`

---

## CASE-NAMING-API: External Vocabulary Leak

**Situation**: Integrating with Stripe for payments, naming internal config and types.

**Hidden Decision**: What vocabulary are we committing to publicly? What happens when we switch providers?

**Tripwire Missed**: "Same as the library calls it" - adopting external vocabulary without considering longevity.

**What Happened**: Used Stripe's terminology throughout the codebase:
- Config key: `stripe.payment_intent.secret`
- Type: `StripePaymentIntent`
- Method: `createStripePaymentIntent()`

Six months later, switched to Adyen. Had to rename across 47 files, update API contracts, and coordinate with mobile team on breaking changes.

**Decision Requirements** (what should have been established):
- Must name for domain concept, not vendor implementation
- Must consider: if we switch providers, what breaks?
- Must distinguish internal vocabulary from external integration points

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what payment vocabulary to commit to**"
- M10 Caller-Need Naming: "What does the caller need? Payment authorization, not Stripe specifically"
- P4: "If we change payment provider, is this name still true?"

**Better Naming**:
| Used | Better | Why |
|------|--------|-----|
| `stripe.payment_intent` | `payments.authorization` | Domain concept |
| `StripePaymentIntent` | `PaymentAuthorization` | Provider-agnostic |
| `createStripePaymentIntent()` | `authorizePayment()` | What, not how |

---

## CASE-NAMING-DATA: Ambiguous Boolean

**Situation**: Adding a status field to track order processing.

**Hidden Decision**: What state transition does this boolean represent? What does "false" mean?

**Tripwire Missed**: Named `active` without clarifying what "active" means in this context.

**What Happened**: Added boolean field `active` to Order table. Over time, different developers interpreted it as:
- "Order is not soft-deleted" (support team's interpretation)
- "Order is currently being processed" (fulfillment team's interpretation)
- "Customer account is active" (billing team's interpretation)

Result: 3 bug reports from inconsistent interpretations. One caused incorrect billing for 200 customers.

**Decision Requirements** (what should have been established):
- Must name the specific state transition
- Must answer: "If this is false, what HAPPENED?"
- Must be unambiguous to readers without context

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what state this boolean represents**"
- M10 State-Transition Booleans: "If this boolean is false, what happened?"
- P3: "What must always be true about this field?"

**Better Naming**:
| Ambiguous | Clear | What False Means |
|-----------|-------|------------------|
| `active` | `is_soft_deleted` | Order was deleted by user/admin |
| `active` | `is_fulfillment_in_progress` | Fulfillment hasn't started or completed |
| `active` | `is_account_enabled` | Account was disabled |

---

## CASE-NAMING-MODULE: Premature Abstraction

**Situation**: Need to share some validation functions between services.

**Hidden Decision**: What boundary are we creating? What belongs here and what doesn't?

**Tripwire Missed**: "I'll just put it in utils" - using a catch-all name that doesn't define boundaries.

**What Happened**: Created `shared/utils/dataUtils.ts` with 3 validation functions. Over 8 months:
- Grew to 30 functions
- Mixed concerns: validation, formatting, parsing, API helpers, date manipulation
- Became the default dumping ground for "doesn't fit anywhere else"
- No one could find anything; IDE autocomplete showed 30 unrelated functions

**Decision Requirements** (what should have been established):
- Must name for what DOESN'T belong, not just what does
- Must create a boundary that makes people hesitate before adding unrelated code
- Must follow P6: check what existing similar modules are called

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what boundary this module creates**"
- M10 Boundary-Definition: "What would make someone HESITATE to add unrelated code?"
- P6: "Where does similar validation logic live?"

**Better Naming**:
| Dumping Ground | Bounded | What Doesn't Belong |
|----------------|---------|---------------------|
| `utils` | `customerDataValidation` | Non-customer, non-validation code |
| `dataUtils` | `orderInputSanitization` | Non-order, non-sanitization code |
| `helpers` | `paymentAmountFormatting` | Non-payment, non-formatting code |

---

## CASE-MIGRATION: Fallback to Deprecated System

**Situation**: Migrating from legacy system to new database.

**Hidden Decision**: What's our failure policy during migration? How do we know migration is complete?

**Tripwire Missed**: "good enough for now" + building fallback without success criteria—committing to a failure policy without explicitly choosing it.

**What Happened**: Built fallback to deprecated system without defining:
- What "success" means for migration
- Whether to fail-loud or graceful-degrade
- Exit criteria for fallback

**Decision Requirements** (what should have been established):
- Must define what "migration complete" means
- Must choose fail-loud vs graceful-degrade explicitly
- Must set exit criteria: when do we remove fallback?

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what our failure policy is during migration**"
- P1: "What's success? Fail-loud or fallback?"
- Effectiveness Contract: Define rollback strategy upfront

---

## CASE-PATTERN: Wrong Pattern for Component

**Situation**: Type errors when implementing a service component.

**Hidden Decision**: What component lifecycle are we committing to? What pattern fits this use case?

**Tripwire Missed**: "I'll just use this pattern" without checking if it fits—the friction (type errors) was a signal that the pattern choice was wrong.

**What Happened**: Used a data-class pattern (immutable value object) for a service component. Worked around type errors instead of questioning pattern choice.

**Friction Signal**: Type system was surfacing a design problem.

**Decision Requirements** (what should have been established):
- Must check if existing services use this pattern
- Must recognize type friction as a design signal, not a bug to work around
- Must consider: is this a data structure or a service?

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what component lifecycle to use**"
- P6: "Do other services use this pattern?" → No → Wrong pattern

---

## CASE-OPS: Missing Operational Imagination

**Situation**: Configuring SSL for external service.

**Hidden Decision**: What failure detection contract are we accepting? How will we know when this breaks?

**Tripwire Missed**: "it works" without ops thinking—successfully configuring something doesn't mean we've decided how to detect when it fails.

**What Happened**: Config worked but no monitoring for SSL verification failures. Would fail silently at 2am; discovery = "user reports login not working."

**Decision Requirements** (what should have been established):
- Must define how we detect SSL failures
- Must specify what alert triggers action
- Must consider: at 2am, how do we know this broke?

**What Would Have Caught It**:
- Decision Surfacing: "We are deciding **what failure detection contract to accept**"
- M5 2am Test: "How do we know this failed? What alert triggers?"

---

## CASE-RABBITHOLE: Execution Drift

**Situation**: Fixing a file upload bug (files >10MB fail), 2-hour timebox.

**Hidden Decision**: When should I stop and reassess? What counts as progress vs. activity?

**Tripwire Missed**: Multiple M8 execution tripwires accumulated without recognition: scope creep, progress illusion, and sunk cost signals.

**What Happened** (time-stamped log):

```
09:00 - Task: Fix upload bug (files >10MB fail). Timebox: 2 hours.
09:30 - "Found the issue might be in chunking. Let me refactor the uploader first so it's easier to debug."
10:30 - "Refactor taking longer than expected. Almost done."
11:00 - "While I'm here, noticed the retry logic is messy. Let me clean that up."
11:30 - "One more try on the chunking. I think I'm 90% there."
12:00 - "Still debugging. Maybe it's a timeout issue... let me try increasing that."
```

**M8 Tripwire Analysis**:

| Time | Signal | Type | Should Have Done |
|------|--------|------|------------------|
| 09:30 | "Let me refactor first" | Scope Creep | Check: Is refactor in Outcome? No → Defer |
| 10:30 | "Almost done" + "longer than expected" | Progress Illusion | What evidence? None → Stop and assess |
| 11:00 | "While I'm here" | Magpie | Not in Outcome → Defer to separate task |
| 11:30 | "90% there" (after "almost done") | Zeno's Paradox | Repeated progress claims without evidence |
| 12:00 | "Maybe it's X..." | Unstructured Search | Timebox exceeded → Escalate |

**Decision Requirements** (what should have been established):

- Must check evidence vs contract at each checkpoint (30-60 min)
- Must distinguish activity (changing code) from progress (evidence)
- Must escalate when timebox exceeded without evidence

**Evidence Audit at 12:00**:

| Evidence Type | Count |
|---------------|-------|
| Tests passing that weren't before | 0 |
| Hypotheses ruled out with data | 0 |
| Repro narrowed or confirmed | 0 |
| Diff closer to complete | 0 (refactor not in scope) |

Verdict: 3 hours of activity, 0 evidence of progress on the original Outcome.

**What Would Have Caught It**:

- M8 catch question at 10:00: "What evidence do I have vs an hour ago?" → "None on original bug"
- M8 at 10:00: Recognize "refactor first" as scope creep, defer to separate task
- M8 at 11:00: Timebox exceeded + no evidence = escalate
- M1 at 11:30: "Stop and Re-derive" - What do I *know* vs *assume* about the bug?

**Correct Response Pattern**:

At 09:30 (first tripwire):
> "Is refactor in my Outcome? No. Options: (a) defer refactor, debug original code; (b) timebox refactor to 30 min then return. Going with (a)—stay on target."

At 10:00 (checkpoint):
> "What evidence do I have vs an hour ago? I've been debugging chunking but haven't ruled anything out. No new test passing. Let me narrow: what's the smallest repro?"

At 11:00 (timebox breach):
> "Timebox exceeded. Evidence: zero. Escalating: 'Timebox exceeded without progress—need guidance on whether to continue or pivot.'"

---

## Adding New Cases

When adding a new case study:

1. Add an entry to the Case Index table above
2. Create a new section following this template:

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

3. Update any documents that reference the new case
