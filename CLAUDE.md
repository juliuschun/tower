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
