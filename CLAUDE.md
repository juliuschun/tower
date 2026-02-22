# Project: tunnelingcc

Remote server setup for accessing Claude Code via web browser.

## Server Info
- Host: Azure VM (azureuser@4.230.33.35)
- Internal IP: 10.0.0.4
- OS: Linux (Ubuntu)
- Node.js: v20.20.0
- Claude Code: v2.1.50

## Claude Desk 서버 관리 (PM2)
- **PM2로 통일 관리** — `npx tsx` 직접 실행 금지 (포트 충돌 위험)
- 설정 파일: `claude-desk/ecosystem.config.cjs` (포트, 환경변수 선언)
- 빌드 + 재시작: `cd claude-desk && npm run restart`
- 로그: `pm2 logs claude-desk`
- 상태: `pm2 show claude-desk`
- 포트: 32354 (Auth 모드, admin/admin123)

## Key Conventions
- Document learnings in `codify.md`
- Korean language preferred for communication

## 워크스페이스 (Enterprise AI Platform)

워크스페이스 경로: `/home/enterpriseai/workspace/`

### 구조
```
workspace/
├── principles.md          # 다섯 가지 원칙
├── memory/MEMORY.md       # 팀 맥락 (항상 최신 유지)
├── decisions/             # 결정 기록 (불변, 파일 하나 = 결정 하나)
├── docs/                  # 정리된 문서 (프로세스, 가이드)
└── notes/                 # 임시 메모, 아이디어
```

### Claude 행동 규칙

**맥락 파악**: 대화 시작 시 `workspace/memory/MEMORY.md`를 읽어 팀 맥락을 파악한다.

**문서 생성**: 대화 중 결정이 나오면 사용자에게 기록 여부를 제안한다.
- 결정 기록 → `decisions/YYYY-MM-DD-제목.md` (`.template.md` 양식 사용)
- 프로세스/가이드 → `docs/제목.md`
- 임시 메모 → `notes/YYYY-MM-DD.md`

**결정 기록 원칙**: decisions/ 파일은 삭제하지 않는다. 결정을 바꾸면 새 파일을 만든다.

**검색**: 사용자가 과거 결정이나 문서를 물으면 decisions/, docs/를 검색해서 맥락과 함께 답변한다.

**원칙 검증** (부드러운 리마인더):
- 결정에 이유가 빠지면: "이유를 남기면 나중에 도움이 됩니다" (원칙 2)
- 제목이 모호하면: "제목을 구체적으로 하면 찾기 쉽습니다" (원칙 3)
