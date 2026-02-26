---
name: swarm
description: Three expert perspectives on your hardest questions. Use when mistakes are expensive.
user-invocable: true
allowed-tools: Task, Read, Write, Glob, Grep, AskUserQuestion
argument-hint: "your question or task"
---

# Swarm — Multiple Experts, One Answer

Spawn agents with different perspectives (3 by default, up to 7). Check if they agree. Synthesize the best answer when they dont. Break it into objectives. Execute. Verify.

## When to use

- Architecture decisions that are hard to reverse
- Security reviews where blind spots mean breaches
- Trade-off analysis (JWT vs sessions, REST vs GraphQL, monolith vs microservices)
- Debugging non-deterministic issues from multiple angles
- User says "ask the swarm", "get opinions", "what do multiple agents think"

## When NOT to use

- Routine implementation. Just write the code.
- Tasks with clear specs. Just follow them.
- Simple factual questions. Just answer.
- Creative work that needs a single coherent vision.

## How it works

### Step 1: Recall learnings

Read `~/.swarm/learnings.jsonl` if it exists. Each line is JSON with `{id, category, content, confidence, times_confirmed, active}`. Sort by `times_confirmed` descending, take top 5 active entries. Keep track of which learning IDs were recalled — you'll need this later.

Format them as context for the agents.

### Step 2: Propose agents and let the user choose

Before spawning, propose a team composition to the user using AskUserQuestion. The default is 3 agents, but the user can adjust.

**Available agent roles** (pick from this pool):

| Role | Perspective | Best for |
|------|-------------|----------|
| Pragmatist | Simplest working path, what actually ships | Implementation decisions, "how do we build this" |
| Skeptic | Failure modes, edge cases, hidden assumptions | Risk assessment, security, reliability |
| Systems Thinker | Second-order effects, long-term consequences | Architecture, scaling, organizational impact |
| Innovator | Unconventional approaches nobody else would try | Creative problems, breaking out of local maxima |
| Contrarian | Argues against the obvious choice to stress-test it | Consensus-challenging, avoiding groupthink |
| Domain Expert | Deep technical accuracy in the specific field | Specialized questions (crypto, ML, distributed systems, etc.) |
| User Advocate | End-user experience, accessibility, simplicity | UX decisions, API design, developer experience |
| Operator | Production reality — deployment, monitoring, incidents | DevOps, infrastructure, operational concerns |

**How to propose**:

Use AskUserQuestion with two questions:

1. "How many expert agents should analyze this?" — options: "3 (Recommended)", "5 (Deeper analysis)", "Custom"
2. Based on the question topic, suggest the best 3 roles as a preset. Example: for a security question, suggest Pragmatist + Skeptic + Operator. For architecture, suggest Pragmatist + Systems Thinker + Contrarian.

If the user picks "Custom" or "Other", let them specify which roles they want and how many (up to 7).

If the user just wants to proceed quickly without customizing, use the recommended defaults and move on.

### Step 3: Spawn agents in parallel

For each chosen agent, use a prompt like this (adapt the role description from the table above):

```
You are a [ROLE]. [ROLE DESCRIPTION FROM TABLE].

QUESTION: $ARGUMENTS

[Include any recalled learnings here]

Give a thorough, actionable answer. At the end, rate your confidence: CONFIDENCE: X/10
```

Use `subagent_type: "general-purpose"` for all agents. Launch ALL of them in a single message (parallel).

### Step 4: Sanity check responses

Before using any agent response, quick scan:
- Empty or trivially short? Drop it.
- Refusal pattern ("I cannot", "I'm unable to")? Drop it.
- Self-reported confidence below 3/10? Drop it.

Two good perspectives beat three where one is junk. Dont retry — work with what you have.

### Step 5: Check consensus

Read the usable responses. Do they substantially agree on the key recommendations?

- **If they agree**: Merge into one answer, keeping each perspective's best insight. Agreement means high confidence.
- **If they disagree**: Synthesize. Note where they differ and why. A minority insight that others missed can be the most valuable part of the whole response.

### Step 6: Slice into objectives

Take the synthesized answer and break it into concrete, ordered next steps. These should be specific enough to execute immediately.

Good objectives:
- "Add rate limiting middleware to the auth endpoints in src/auth/routes.ts"
- "Write integration tests covering the token refresh edge case"
- "Refactor the cache layer to use write-through instead of write-behind"

Bad objectives:
- "Consider security implications" (too vague)
- "Improve the architecture" (not actionable)
- "Think about edge cases" (thats analysis, not a mission)

Each objective should be one clear thing to do. If its too big, split it. If the agents disagreed on approach, pick the strongest reasoning and note the trade-off.

Order by dependency — things that need to happen first go first.

### Step 7: Present the result

Show the user:

1. **Answer** — the synthesized recommendation
2. **Where they agreed** — high-confidence points all three landed on
3. **Where they differed** — trade-offs, tensions, minority insights worth paying attention to
4. **Confidence** — overall confidence based on how much they aligned
5. **Objectives** — numbered list of concrete next steps, ready to execute

### Step 8: Execute objectives

Proceed to work through the objectives in order. Dont stop at the opinion. Start doing.

- Work through objectives sequentially (earlier ones may inform later ones)
- If an objective requires user input or a decision, ask before proceeding
- If an objective turns out to be unnecessary based on what you find, skip it and explain why
- Mark each objective as you complete it so the user can track progress

### Step 9: Verify

After completing the objectives, spawn a Task agent to review the work:

```
You are a reviewer. Look at what was just done and check:

1. Do the changes actually address the original question?
2. Are there obvious issues, bugs, or gaps?
3. Did anything get missed from the original plan?
4. Is there anything that should be rolled back or revised?

ORIGINAL QUESTION: $ARGUMENTS
OBJECTIVES COMPLETED: [list what was done]
FILES CHANGED: [list files modified]

Be specific. If something needs fixing, say exactly what and where.
```

Use `subagent_type: "general-purpose"` so the reviewer can read the actual files.

- **If the reviewer finds issues**: Fix them. Work through the feedback, then move on.
- **If the reviewer finds nothing**: Done. Move to saving learnings.

Dont loop more than once. If the fix creates new issues, flag them for the user rather than spiraling.

### Step 10: Save learnings

Two things happen here.

**Confirm recalled learnings**: If learnings from Step 1 were recalled and the result was good, increment `times_confirmed` for each one. Read `~/.swarm/learnings.jsonl`, find the entries by ID, update the count, write the file back. This is how useful learnings rise over time.

**Save new insights**: If the answer or execution revealed something reusable, append to `~/.swarm/learnings.jsonl`:

```json
{"id":"<random-12-hex>","ts":"<ISO-8601>","category":"strategy","tags":[],"content":"<the insight>","confidence":0.7,"times_confirmed":0,"active":true}
```

Categories: `mistake`, `strategy`, `pattern`, `constraint`.

Only save genuine insights, not the full answer. One learning per run is plenty. If nothing is worth saving, dont save anything.

## Scaling up

- The user chooses how many agents to spawn in Step 2. Default is 3, but 5 or 7 is supported for harder questions.
- For code questions, use `subagent_type: "general-purpose"` so agents can read files and explore the codebase.

## Important

- Present results as "heres what multiple experts concluded." Not absolute truth.
- The value is in the diversity. Not in any single agent's answer.
- If all agents agree easily, the question probably didnt need swarm.
- Disagreements are features. Highlight them.
