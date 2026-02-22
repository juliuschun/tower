# Naming: Expert Judgment for Identifiers

**Purpose**: Expert naming strategies for APIs, data models, modules, and code.
Complements M10 (Mental Model Alignment) in mindset.md.

---

## The Expert Paradox

Novices need good names MORE than experts (who compensate with context).
But experts create bad names because they don't experience the confusion ("curse of knowledge").

**The asymmetry**:
- Writers have full context → name "makes sense" to them
- Readers lack context → must infer meaning from name alone
- Expert writers underestimate this gap

---

## Five Expert Naming Strategies

| Strategy | Catch Question | Anti-Pattern | Applies To |
|----------|----------------|--------------|------------|
| **Skip-Reading Test** | "Can I understand this WITHOUT reading the code?" | Generic names (`data`, `process`, `handle`) | Functions, variables |
| **Caller-Need Naming** | "What does the CALLER need, not how I provide it?" | Implementation in interface (`kafkaConsumer`) | APIs, config keys |
| **State-Transition Booleans** | "If this boolean is false, what HAPPENED?" | Ambiguous state (`active`, `processed`) | Data fields |
| **Boundary-Definition** | "What would make someone HESITATE to add unrelated code?" | Catch-all names (`utils`, `helpers`, `misc`) | Modules, packages |
| **Collision Awareness** | "What do we already call similar things?" | Inventing new patterns when existing ones fit | All naming |

---

## Naming as Cognitive Design

Names aren't just labels - they're **external cognitive artifacts**:

1. **Chunk Keys**: Good names trigger retrieval of rich associated concepts
   - `validateAndEnrichCustomerRecord` → retrieves full operation concept
   - `processData` → requires reading code to understand

2. **Beacons**: Distinctive names serve as landmarks for code navigation
   - Experts perceive "authentication flow" where novices see "a bunch of functions"
   - Names should enable this pattern-level recognition

3. **Exclusion Signals**: Good module names tell you what DOESN'T belong
   - `customerDataTransforms` creates a boundary
   - `utils` is an invitation to dump anything

---

## Expert Internal Monologues

**Perspective-Taking**:
> "If Sarah joins next month and sees this, what will she think? She knows our domain but not our implementation history. What name would make her guess CORRECTLY?"

**Temporal Projection**:
> "This is implemented with Kafka now, but the NAME shouldn't know that. What name would survive if we switch?"

**Negative Space Reasoning**:
> "If I call this `utils`, ANYTHING could go in here. That's a bug. What name would make someone HESITATE before adding unrelated code?"

**Collision Awareness**:
> "Before I invent a name, what do we already call similar things? Let me grep... we use 'Service' for stateless, 'Manager' for stateful."

---

## Naming by Artifact Type

### API & Config Names

- **Risk**: Vocabulary commits publicly; hard to change
- **Strategy**: Caller-Need Naming + Skip-Reading Test
- **Anti-pattern**: External library vocabulary leak

| Bad | Good | Why |
|-----|------|-----|
| `kafka.bootstrap.servers` | `messaging.connection.servers` | Survives provider switch |
| `s3.bucket.name` | `storage.bucket.name` | Caller needs storage, not S3 specifically |
| `stripePaymentIntent` | `paymentAuthorization` | Domain concept, not vendor |

### Data Schema Names

- **Risk**: Migration cost; misinterpretation causes bugs
- **Strategy**: State-Transition Booleans + Skip-Reading Test
- **Anti-pattern**: Ambiguous booleans that mean different things to different readers

| Bad | Good | Why |
|-----|------|-----|
| `active` | `is_soft_deleted`, `is_processing`, `is_account_enabled` | Names the specific state transition |
| `processed` | `has_completed_fulfillment` | Clear what "processed" means |
| `status` | `payment_status`, `order_lifecycle_stage` | Scoped to specific domain |

### Module/Package Names

- **Risk**: Dumping ground; attracts unrelated code
- **Strategy**: Boundary-Definition + Collision Awareness
- **Anti-pattern**: Catch-all names that don't exclude anything

| Bad | Good | Why |
|-----|------|-----|
| `utils` | `customerDataTransforms` | Tells you what DOESN'T belong |
| `helpers` | `orderValidation` | Creates a clear boundary |
| `common` | `sharedAuthMiddleware` | Specific about what's shared |

---

## The Three-Stage Check

For any naming decision:

1. **WHO**: What's the reader's mental model?
   - Who will read this name most often?
   - What context do they have? What do they lack?

2. **WHAT**: Does name survive implementation changes? (P4)
   - If we change the underlying technology, is the name still accurate?
   - Does the name describe the "what" or the "how"?

3. **WHERE**: What do similar things call this? (P6)
   - What existing naming patterns should we follow?
   - Would a new name create confusion with existing names?

---

## Friction Signals

| Signal | What It Indicates |
|--------|-------------------|
| Name requires verbal explanation in PR | Self-documenting failed |
| "What does this do again?" (repeated) | Name doesn't convey meaning |
| IDE autocomplete confusion | Names not discriminable |
| Same name means different things in different contexts | Overloaded vocabulary |
| Comments explaining what the name "really" means | Name is misleading |

---

## Naming Compounds (Expert Pattern)

Experts naturally use compound names that encode purpose:

| Novice | Expert | What's Added |
|--------|--------|--------------|
| `data` | `customerOrderHistory` | Domain + entity + time aspect |
| `result` | `validationErrors` | Operation outcome type |
| `process()` | `calculateShippingCost()` | Verb + domain + target |
| `handle()` | `routeIncomingWebhook()` | Action + direction + entity |
| `check()` | `validatePaymentEligibility()` | Action + domain + condition |

---

## Related Documents

- [mindset-advanced.md M10](mindset-advanced.md#m10-mental-model-alignment) - The mental habit
- [principles.md P4](principles.md#p4-isolate-volatility) - Names should survive change
- [principles.md P6](principles.md#p6-consistency-is-a-feature) - Check existing naming patterns
- [cases.md](cases.md) - CASE-NAMING-* worked examples
