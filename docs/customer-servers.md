# Customer Servers — 고객 서버 레지스트리 & 운영 로그

> 배포된 모든 고객 Tower 서버의 현황과 운영 이력을 기록하는 문서.
> 서버 추가·업데이트·장애 발생 시 반드시 이 문서를 갱신할 것.

---

## 서버 레지스트리

| 고객 | VM 이름 | IP | 도메인 | SSH | VM 스펙 | 리소스 그룹 | 리전 | 배포일 |
|------|---------|-----|--------|-----|---------|------------|------|--------|
| **Moat AI (내부)** | enterpriseai | — | `tower.moatai.app` | — (로컬) | Standard_D4s_v3 | — | koreacentral | 2026-02 |
| **okusystem (오케이유)** | okusystem | 20.41.101.188 | `okusystem.moatai.app` | `toweradmin@20.41.101.188` | Standard_B2ms (2vCPU/8GB) | tower_customers | koreacentral | 2026-04-04 |

### 서버 상세

#### Moat AI (내부 — Dev + Prod)

- **Dev**: `desk-dev.moatai.app` → :32354/:32355 (tsx watch)
- **Prod**: `tower.moatai.app` → :32364 (PM2 `tower-prod`)
- **DB**: PostgreSQL (로컬)
- **스킬 프로필**: internal (전체)
- **비고**: 개발 + 운영 겸용. 모든 기능 활성화.

#### okusystem (오케이유)

- **도메인**: `okusystem.moatai.app`
- **VM**: Standard_B2ms (2 vCPU / 8GB RAM), 128GB 디스크, 4GB swap
- **DB**: PostgreSQL 14 (로컬)
- **SSL**: certbot (만료 2026-07-02 — 갱신 확인 필요)
- **Claude 인증**: Max subscription (credentials 복사)
- **기본 모델**: sonnet
- **Pi 엔진**: 비활성 (PI_ENABLED=false)
- **스킬 프로필**: customer-basic (core + business + docs, 26개)
- **PM2 프로세스**: `tower-prod` (:32364)
- **배포 방식**: git pull origin main (GitHub SSH key 설정됨)
- **참고 문서**: `docs/plans/2026-04-03-azure-okusystem-prod-install.md`

---

## 배포 이력 (Deploy Log)

최신이 위로 오도록 기록.

### okusystem

| 날짜 | 커밋 | 주요 변경 | 비고 |
|------|------|----------|------|
| 2026-04-13 | `3529b7fa` | Publishing Hub 제거→Backend 통합, TOWER_ROLE config, customer-servers.md, prefetch 최적화, font size, Proactive Agent/Inbox UX | Hub 의존성 완전 제거. "Hub not reachable" 에러 해소 |
| 2026-04-13 | `9fdca6bb` | UI polish, turn badge read system, font size 설정, 스트리밍 스크롤 개선, Proactive Agent/Inbox UX | npm install + build + PM2 restart 정상 |
| 2026-04-12 | `b3795f58` | Proactive Inbox UX, Proactive Agent, 스트리밍 스크롤 개선, turn-phase 모델, i18n 인프라, Usage 패널, local-engine, update coordinator | 대규모 업데이트. 126 files changed (+9422 -1511). DB 마이그레이션 2개 (021, 022) 포함 |
| 2026-04-04 | `a0f0025` | 최초 배포 | VM 생성 → 전체 프로비저닝. 런북 기준 배포 |

### Moat AI (내부)

| 날짜 | 커밋 | 주요 변경 | 비고 |
|------|------|----------|------|
| 2026-04-13 | `3529b7fa` | Publishing Hub→Backend 통합, TOWER_ROLE, arch doc, 고객 가이드 | Phase 1+2 완료 |
| 2026-04-13 | `9fdca6bb` | UI polish + turn badge read system | Dev + Prod 동시 반영 |

---

## 업데이트 절차 (Quick Reference)

### 기존 고객 서버 업데이트

```bash
# 1. 이 서버에서 origin push (이미 안 했다면)
git push origin main

# 2. 고객 서버에 SSH로 배포
ssh toweradmin@<IP> "cd ~/tower && git pull origin main && npm install && ./start.sh prod-restart"

# 3. 검증
ssh toweradmin@<IP> "cat /tmp/tower-deploy.log | tail -5 && pm2 list"

# 4. 이 문서에 배포 이력 추가!
```

### DB 마이그레이션이 포함된 경우

- 마이그레이션은 서버 시작 시 자동 실행됨
- `dist/` 빌드 시 `.sql` 파일이 자동 복사되지 않을 수 있음 → `start.sh`가 처리
- 마이그레이션 실패 시 PM2 로그 확인: `ssh toweradmin@<IP> "pm2 logs tower-prod --lines 50"`

### 스킬 업데이트 (코드 배포와 별도)

```bash
# library.yaml 기반 프로필 배포
bash ~/.claude/skills/library/deploy-profile.sh --customer okusystem

# 배포 후 PM2 재시작 (스킬 캐시 갱신)
ssh toweradmin@<IP> "pm2 restart tower-prod --update-env"
```

---

## 장애 & 이슈 로그

장애 발생 시 여기에 기록. 해결 방법 포함.

### okusystem

| 날짜 | 증상 | 원인 | 해결 |
|------|------|------|------|
| *(아직 없음)* | | | |

### 공통 트러블슈팅

| 증상 | 원인 가능성 | 확인 방법 | 해결 |
|------|-----------|----------|------|
| 사이트 접속 불가 | PM2 프로세스 다운 | `ssh ... "pm2 list"` | `pm2 restart tower-prod` |
| 502 Bad Gateway | 백엔드 미시작 or 포트 충돌 | `pm2 logs tower-prod --lines 30` | 로그 확인 후 restart |
| SSL 인증서 만료 | certbot 갱신 실패 | `ssh ... "sudo certbot certificates"` | `sudo certbot renew` |
| 디스크 부족 | .claude/ 세션 누적 | `ssh ... "df -h && du -sh ~/.claude/"` | 오래된 세션 정리 |
| 높은 CPU | 좀비 Claude 프로세스 | `ssh ... "pgrep -fa claude"` | 불필요 프로세스 kill |
| DB 마이그레이션 실패 | SQL 파일 누락 | `pm2 logs` 확인 | `cp -r migrations dist/` 후 restart |

---

## 신규 고객 추가 체크리스트

1. [ ] `docs/azure-customer-deployment-runbook.md` 따라 VM 생성 + 프로비저닝
2. [ ] 이 문서 **서버 레지스트리**에 행 추가
3. [ ] `~/.claude/skills/library/library.yaml` → `customers:` 섹션에 등록
4. [ ] 스킬 배포: `deploy-profile.sh --customer <name>`
5. [ ] SSL 인증서 만료일 확인 & 캘린더 등록
6. [ ] 첫 배포 이력을 **배포 이력** 섹션에 기록

---

## 참고 문서

- 신규 배포 런북: `docs/azure-customer-deployment-runbook.md`
- 배포 아키텍처: `docs/azure-prod-deployment.md`
- 스킬 프로필 관리: `~/.claude/skills/library/library.yaml`
- 배포 스크립트: `scripts/azure/create-vm.sh`, `bootstrap-prod.sh`, `deploy-e2e.sh`
- okusystem 설치 계획: `docs/plans/2026-04-03-azure-okusystem-prod-install.md`
- Dev/Prod 운영 가이드: `devserver.md`
- **Publishing 재설계**: `docs/plans/arch_0413_publish-gateway-redesign.md` (TOWER_ROLE, Gateway 설계)
- 배포 엔진 (기존): `docs/deploy-engine.md` (Cloudflare/Azure 직접 배포)
