# {{TEAM_NAME}} — Workspace

This directory is the **team brain** — decisions, docs, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## Tower 제품 가이드

사용자가 Tower 사용법, 기능, 스킬, 시각화, 권한 등을 물으면 `guide/tower-knowledge.md`를 참조하여 답변하세요.
- 기능 질문 → `guide/tower-knowledge.md`
- 시작 방법 → `guide/getting-started.md`
- 활용 팁 → `guide/tips.md`

사용자가 "뭘 할 수 있어?", "도움말", "기능 목록", "스킬 목록" 등을 물으면:
- 설치된 스킬과 각 1줄 설명을 보여주세요
- 시각화 기능 예시를 포함하세요
- "이런 것도 할 수 있어요" 식으로 구체적 예시를 들어주세요

## Directory Structure

```
workspace/
├── CLAUDE.md              # ← This file (AI behavior + workspace guide)
├── principles.md          # Team principles
├── decisions/             # Team-wide decision records (immutable)
├── docs/                  # Process docs, guides, SOPs
└── projects/              # Project folders (Tower auto-creates)
    └── <project>/
        ├── AGENTS.md      # Project context for AI (auto-generated)
        ├── CLAUDE.md      # → symlink to AGENTS.md
        └── .project/      # System-managed metadata
            ├── progress.md      # Work log (append-only)
            ├── decisions/       # Project-level decisions
            └── state.json       # Evolution tracking
```

## Project-Centric Architecture

**Project is the center of everything.** A project groups:
- Channels (team chat)
- Sessions (AI work, private or shared)
- Files (project folder = shared drive)
- AI context (CLAUDE.md per project)

Inviting someone to a project grants access to all of the above.

## Agent Behavior Rules

### On Session Start

1. **Know `principles.md`** — especially "Write it down" and "Record the why"
2. **Search `decisions/` and `docs/`** before starting any task — check for prior art
3. **If working inside a project** (cwd under `workspace/projects/<name>/`), skim
   `.project/progress.md` and `.project/decisions/` for recent context. The
   `.project/` folder is dot-hidden but it's where the project's memory lives.

### While Working

- **Work log**: After meaningful work, append a dated entry to `.project/progress.md`. Even one line counts.
- **Decisions → right place**: Does it affect other projects? → `workspace/decisions/`. Just this project? → `.project/decisions/`. Not sure? → `.project/decisions/` (can move later).
- **File naming**: decisions → `YYYY-MM-DD-title.md`
- **`decisions/` files are immutable.** To change a decision, create a new file.
- **AGENTS.md is auto-generated.** Don't edit directly — use `/agents-md --evolve` to refresh from progress & decisions.
- **Tasks under 15 min: just do them.** The task system is for 30+ min work.

### When Writing Docs

- Markdown. Specific titles ("Apply API cache" O, "Performance improvements" X)
- Always include the **why**: "We went with A over B because X."
- Assume the reader is smart but not a developer — explain jargon inline.

## Communication Style

When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after

## Publishing — 사이트 배포

사용자가 웹 페이지, 사이트, 대시보드 등의 생성을 요청하면:

1. `workspace/published/sites/사이트이름/` 폴더에 파일 생성
2. `index.html` 필수 포함
3. 폴더 이름 규칙: 소문자 영어 + 숫자 + 하이픈만 (`my-report`, `team-wiki`)

**접근 URL** (폴더 생성 즉시 접근 가능):
- 기본: `https://서버도메인/sites/사이트이름/`
- 서브도메인: `https://사이트이름.서버도메인/`

**수정**: 파일만 변경하면 즉시 반영. 별도 배포 과정 없음.
**삭제**: 폴더 삭제 (사용자에게 확인 후).

예시 요청과 응답:
- "제품 소개 페이지 만들어줘" → `published/sites/product-intro/index.html` 생성
- "대시보드 색상 바꿔줘" → 해당 파일 수정
- "배포된 사이트 목록" → `published/sites/` 폴더 목록 조회

## 링크 규칙

URL이나 파일 경로를 사용자에게 안내할 때 **반드시 클릭 가능한 전체 URL**로 제공한다.
- ✅ `https://도메인/sites/my-report/` (클릭 가능)
- ❌ `published/sites/my-report/` (파일 경로만)

Published 사이트 → `https://서버도메인/sites/<사이트이름>/`

## Warnings

- **Never commit `.env`, credentials, or secret files** (check `.gitignore`)
- Modifying this file requires team discussion and a `decisions/` record
