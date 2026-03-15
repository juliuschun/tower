# {{TEAM_NAME}} — Workspace

This directory is the **team brain** — decisions, docs, memos, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## Role of This Directory

| This workspace | Code project CLAUDE.md |
|---|---|
| Team collaboration rules, doc structure, AI behavior | Build/dev rules for that specific codebase |

## Directory Structure

```
workspace/
├── CLAUDE.md              # ← This file (AI behavior + workspace guide)
├── principles.md          # Team principles
├── memory/MEMORY.md       # Team context (current priorities, structure, rhythm)
├── decisions/             # Decision records (immutable — never delete/modify)
├── docs/                  # Process docs, guides, SOPs
├── notes/                 # Temporary memos, ideas
└── projects/              # (Optional) Per-project outputs
```

## Agent Behavior Rules

### On Session Start

1. **Read `memory/MEMORY.md`** — understand team status and priorities
2. **Know `principles.md`** — especially "Write it down" and "Record the why"
3. **Search `decisions/` and `docs/`** before starting any task — check for prior art

### While Working

- **Decisions → suggest recording**: "Want to record this in `decisions/`?"
- **File naming**: decisions → `YYYY-MM-DD-title.md`, notes → `YYYY-MM-DD.md`
- **`decisions/` files are immutable.** To change a decision, create a new file.
- **Tasks under 15 min: just do them.** The task system is for 30+ min work.

### When Writing Docs

- Markdown. Specific titles ("Apply API cache" ✓, "Performance improvements" ✗)
- Always include the **why**: "We went with A over B because X."
- Assume the reader is smart but not a developer — explain jargon inline.

## Communication Style

When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after

## Cleanup Rhythm

| Frequency | Action |
|---|---|
| **Weekly** | Scan `notes/` → promote anything important to `decisions/` or `docs/` |
| **Monthly** | Review `docs/` — still accurate? |
| **Quarterly** | Update `memory/MEMORY.md` — reprioritize |

## 시각화 포맷

Tower 채팅에서 데이터를 시각적으로 보여줄 때 다음 코드블록을 사용하세요:

- **다이어그램**: ` ```mermaid ` (flowchart, sequence, class, ER 등)
- **차트**: ` ```chart ` (JSON: type, data, xKey, yKey)
- **수식**: `$$블록$$` (LaTeX — 인라인 `$`는 사용하지 마세요)
- **데이터 테이블**: ` ```datatable ` (JSON: columns, data)
- **타임라인**: ` ```timeline ` (JSON: items)

차트 type: `bar`, `line`, `area`, `pie`, `scatter`, `radar`, `composed`

규칙:
- 숫자 비교 3행 이상 → 차트 사용
- 항목 비교 → datatable 사용
- JSON은 반드시 valid JSON (trailing comma, 주석 금지)

## Warnings

- **Never commit `.env`, credentials, or secret files** (check `.gitignore`)
- **Never delete or modify files in `decisions/`** — create a new file instead
- When modifying this CLAUDE.md, note the reason in `decisions/`
