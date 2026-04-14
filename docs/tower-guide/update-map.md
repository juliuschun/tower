# 업데이트 맵 — 어디를 고쳐야 하나

"이걸 바꾸고 싶은데 어디를 건드려야 해?" 에 대한 답.

## 빠른 참조

| 바꾸고 싶은 것 | 파일 | 배포 방법 |
|---------------|------|----------|
| AI 응답 스타일/규칙 (모든 세션) | `system-prompt.ts` 또는 DB `system_prompts.default` | 코드: git push + restart. DB: Admin 즉시 |
| 시각화 포맷 추가 | `system-prompt.ts` vizGuide + 프론트 컴포넌트 | 코드 배포 |
| Tower 개발 규칙 | `tower/AGENTS.md` (= CLAUDE.md) | git push |
| 글로벌 규칙 (모든 프로젝트) | `~/.claude/CLAUDE.md` | 파일 수정 즉시 |
| 스킬 추가/수정 | `~/.claude/skills/<name>/SKILL.md` | 파일 수정 즉시 |
| 스킬 카탈로그 | `~/.claude/skills/library/library.yaml` | 파일 수정 |
| 고객에 스킬 배포 | `deploy-profile.sh --customer <name>` | rsync |
| 사용자 역할/권한 | Admin Panel (UI) 또는 `auth.ts` | UI 즉시 / 코드 배포 |
| 프로젝트별 지시 | `workspace/projects/<name>/CLAUDE.md` | 파일 수정 즉시 |
| 고객 VM 템플릿 | `tower/templates/workspace/CLAUDE.md` | git push + 신규 배포 시 적용 |
| 메모리 | `MEMORY.md` 또는 `/memory` 검색 | 자동/수동 |

## 시각화 포맷 추가 체크리스트

새로운 코드블록 포맷을 추가할 때:

1. **프론트엔드 컴포넌트**: `packages/frontend/src/components/chat/<Name>Block.tsx` 생성
2. **블록 파서 등록**: `packages/shared/split-dynamic-blocks.ts`에 블록명 추가
3. **RichContent 등록**: `packages/frontend/src/components/shared/RichContent.tsx`에 lazy import
4. **시스템 프롬프트**: `system-prompt.ts` vizGuide에 포맷 설명 추가
5. **CLAUDE.md**: `tower/AGENTS.md` 확장 포맷 테이블에 추가 (개발 참고용)

## 고객 배포 체크리스트

고객 서버 업데이트 시:

1. `git pull origin main` — 코드 + docs 업데이트
2. `npm install` — 의존성
3. `./start.sh prod-restart` — PM2 재시작
4. 스킬 변경이 있으면: `deploy-profile.sh --customer <name>`
5. `docs/customer-servers.md`에 버전/날짜 기록

## 주의사항

- **system-prompt.ts 변경**: 모든 세션에 영향. 토큰 비용 고려.
- **CLAUDE.md 심링크**: `tower/CLAUDE.md`는 `AGENTS.md`의 심링크. 실제 파일은 `AGENTS.md`.
- **DB 시스템 프롬프트**: Admin에서 편집 가능하지만, `system-prompt.ts`와 결합됨. 둘 다 확인할 것.
- **스킬 description**: 트리거 정확도에 직결. 변경 시 의도치 않은 트리거/미트리거 확인.
