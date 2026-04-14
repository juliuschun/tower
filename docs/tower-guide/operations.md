# 운영 가이드

## 환경 구성

| 환경 | 도메인 | 포트 | 프로세스 |
|------|--------|------|---------|
| Dev | desk-dev.moatai.app | :32354/:32355 | tsx watch |
| Prod | tower.moatai.app | :32364 | PM2 `tower-prod` |
| Redirect | desk.moatai.app | — | Nginx 301 → tower |

- DB(PostgreSQL), workspace, `~/.claude/`, API 키 모두 공유
- Dev 코드 수정 → tsx watch 자동 재시작 → Prod 영향 없음

## 배포

### 우리 Prod 서버
```bash
./start.sh prod-restart  # Dev 세션에서만 실행!
```

### 고객 VM 업데이트
```bash
ssh toweradmin@<IP> "cd ~/tower && git pull origin main && npm install && ./start.sh prod-restart"
```

### 스킬 배포 (고객 VM)
```bash
bash ~/.claude/skills/library/deploy-profile.sh --customer <name>
```

## 고객 서버 레지스트리

- **목록**: `docs/customer-servers.md`
- **런북**: `docs/azure-customer-deployment-runbook.md`
- **스킬 프로필**: `~/.claude/skills/library/library.yaml` → `customers:` 섹션

### 현재 고객

| 이름 | IP | 도메인 | 프로필 |
|------|-----|--------|--------|
| okusystem | 20.41.101.188 | okusystem.moatai.app | managed |

## 주의사항

- `npm run dev` 다중 실행 금지 (tsx watch 좀비 → 포트 충돌)
- 작업 중 백엔드 재시작 금지 (실행 중 태스크 죽음)
- Prod 재시작은 Dev 세션에서만 (Prod 세션에서 하면 무한 루프)
- `install-skills.sh` 직접 실행 금지 (CPU 폭주 이력)

## 관련 문서

- 상세 서버 운영: `devserver.md`
- 사고 히스토리: `codify.md` ("좀비" 검색)
- 배포 아키텍처: `docs/azure-prod-deployment.md`
- Publishing: `docs/publishing-guide.md`
