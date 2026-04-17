# Tower Agent Reference

AGENTS.md에는 항상 필요한 핵심 규칙만 둡니다. 이 문서는 필요할 때만 읽는 상세 참고서입니다.

## 시각화 참고
- 기본 원칙: 숫자 비교는 chart, 흐름/구조는 mermaid, 표 비교는 datatable, 절차는 steps를 우선 사용합니다.
- 자세한 포맷과 예시는 `docs/plans/dynamic-visual.md` 및 `docs/tower-guide/visual-formats.md`를 참고합니다.
- 민감한 값이 필요하면 `secure-input` 블록을 사용합니다.

## 고객 서버 운영 참고
- 서버 레지스트리: `docs/customer-servers.md`
- 신규 배포 절차: `docs/azure-customer-deployment-runbook.md`
- 배포 아키텍처 요약: `docs/azure-prod-deployment.md`
- Publishing 전체 가이드: `docs/publishing-guide.md`
- 배포 엔진 참고: `docs/deploy-engine.md`

## Dev 서버 운영 참고
- 상세 운영 가이드: `devserver.md`
- 장애/주의 이력: `codify.md`
- 백엔드 좀비 프로세스 이슈는 `codify.md`에서 "좀비" 또는 "zombie"로 검색합니다.

## 문서화 위치
- 팀 공통 결정: `workspace/decisions/YYYY-MM-DD-title.md`
- 프로젝트 결정: `workspace/projects/<project>/.project/decisions/YYYY-MM-DD-title.md`
- 프로세스/가이드: `workspace/docs/title.md`

## Workspace 구조 참고
- 기본 구조와 운영 원칙은 상위 `AGENTS.md`와 `templates/workspace/CLAUDE.md`를 함께 참고합니다.
