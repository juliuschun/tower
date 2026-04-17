# {{TEAM_NAME}} — Workspace

This directory is the **team brain** — decisions, docs, and project outputs.
It is *not* a code project. For code-specific rules, see each repo's own CLAUDE.md.

## 핵심 원칙
- 시작할 때 `principles.md`, `decisions/`, `docs/`를 먼저 확인합니다.
- 프로젝트 안에서 작업 중이면 `.project/progress.md`와 `.project/decisions/`를 우선 확인합니다.
- 결정이 생기면 적절한 위치에 기록합니다.
- `decisions/` 파일은 immutable입니다. 변경이 필요하면 새 파일을 만듭니다.
- 설명은 쉬운 말부터 하고, 기술 용어는 필요할 때만 짧게 풀이합니다.

## 문서화 위치
- 팀 공통 결정: `workspace/decisions/YYYY-MM-DD-title.md`
- 프로젝트 결정: `workspace/projects/<project>/.project/decisions/YYYY-MM-DD-title.md`
- 프로세스/가이드: `workspace/docs/title.md`

## 작업 중 원칙
- 15분 이내 작업은 바로 진행합니다.
- 의미 있는 작업 후에는 `.project/progress.md`에 짧게라도 남깁니다.
- 프로젝트별 규칙은 해당 프로젝트의 `AGENTS.md` / `CLAUDE.md`를 우선합니다.
- URL 안내 시에는 항상 클릭 가능한 전체 URL을 제공합니다.

## Publishing — 웹 앱 & 사이트 배포

사용자가 웹 페이지, 대시보드, 계산기, 도구, 앱 등을 요청하면 **반드시 `published/sites/`에 배포**합니다.

### ⚠️ 절대 하지 말 것
- `python -m http.server`, `flask run`, `node server.js` 등 **localhost 서버를 띄우지 않습니다.**
- localhost:XXXX는 사용자 PC 브라우저에서 접근할 수 없습니다.
- 사용자에게 "localhost로 접근하세요"라고 안내하지 않습니다.

### 올바른 방법
1. `workspace/published/sites/<사이트이름>/` 폴더 생성
2. `index.html` 필수
3. 폴더 이름 = 서브도메인. 소문자 영문 + 숫자 + 하이픈만 (`my-report`, `calc-tool`), 영문/숫자로 시작.

**접근 URL — 서브도메인만 안내:**
- ✅ `https://<사이트이름>.<SERVER_DOMAIN>/` — 와일드카드 nginx가 폴더를 직접 서빙합니다.
- ❌ `https://<SERVER_DOMAIN>/sites/<사이트이름>/` — 현재 nginx에서는 Tower SPA로 라우팅됩니다. 안내 금지.

수정은 파일만 바꾸면 즉시 반영. 별도 배포 절차 없음. 삭제는 폴더 삭제(사용자 확인 후).

### 동적 앱 / 외부 공개
대부분 클라이언트 사이드 JS로 충분합니다 (Chart.js, SheetJS, Papa Parse 등 CDN 라이브러리).
서버 사이드 또는 외부 공개가 필요하면 `~/workspace/scripts/deploy.sh`(설치된 경우)를 사용합니다:
- 정적 + CDN: `deploy.sh <name> <폴더>`
- 동적(Python/Node): `deploy.sh <name> <폴더> --type dynamic --port 8000`
- 로컬만: `deploy.sh <name> <폴더> --local`

## 필요 시 추가 참고
Tower 사용법·기능·시각화·권한 등 질문이나 상세한 운영/구조/절차가 필요할 때만 아래 문서를 읽습니다.
- 에이전트 참고서: `docs/agents-reference.md`
- 프로젝트별 진행/결정: `.project/progress.md`, `.project/decisions/`
- 팀 공통 문서: `decisions/`, `docs/`

## Directory Structure

```
workspace/
├── CLAUDE.md              # ← This file
├── principles.md          # Team principles
├── decisions/             # Team-wide decision records (immutable)
├── docs/                  # Process docs, guides, SOPs
└── projects/              # Project folders (Tower auto-creates)
    └── <project>/
        ├── AGENTS.md      # Project context for AI
        ├── CLAUDE.md      # → symlink to AGENTS.md
        └── .project/      # System-managed metadata
            ├── progress.md
            ├── decisions/
            └── state.json
```

## Communication Style
When explaining technical decisions or architecture:
- Plain language, everyday analogies
- Simplest explanation first, detail only if asked
- If a technical term is necessary, explain it in one sentence right after

## Warnings
- Never commit `.env`, credentials, or secret files.
- If this file's default behavior changes materially, record that decision in workspace docs or decisions.
