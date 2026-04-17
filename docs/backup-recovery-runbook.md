# Backup & Recovery Runbook

**정책 결정**: `workspace/decisions/2026-04-17-customer-vm-backup-policy.md`
**최종 업데이트**: 2026-04-17

---

## 0. 티어별 적용 범위 (가장 먼저 확인)

| 티어 | 누가 운영? | Layer 1 cron | Layer 2 Vault | 자동화 위치 |
|---|---|---|---|---|
| **standalone** | 고객 본인 | 자동 등록 ❌ (가이드만) | ❌ (권한 없음) | — |
| **managed** | Tower팀 | ✅ `bootstrap-prod.sh --tier managed` | ✅ `az backup protection enable-for-vm` | Tier 4 자동 + Vault 수동 |
| **full / 본 서버** | Moat AI 내부 | `backup-to-blob.sh` + PG cron | ⏳ `tower-backup-eastus2` 미구성 | 별도 (bootstrap-prod.sh 미사용) |

> 새 고객 VM이 들어오면 먼저 어느 티어인지 확정한 뒤 이 가이드의 해당 섹션을 본다.

---

## 1. 전체 구조 (managed 기준)

```
┌─ Layer 1 (앱 백업) ─────────────────────────────────────┐
│  매일 03:00 KST                                          │
│  scripts/backup.sh                                       │
│    → pg_dump -Fc  → ~/backups/<TS>/postgres.dump         │
│    → tar workspace/ (옵션) + ~/.claude/                  │
│    → .env 복사                                           │
│    → 7일 보관 (KEEP_DAYS=7)                              │
└──────────────────────────────────────────────────────────┘

┌─ Layer 2 (VM 스냅샷) ───────────────────────────────────┐
│  매일 00:30 KST (UTC 15:30)                              │
│  Azure Recovery Services Vault                           │
│    Vault: tower-backup-koreacentral (GRS, koreacentral)  │
│    Policy: DefaultPolicy (Daily / 30-day retention)      │
│    등록 VM: okusystem, demo-tower                        │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1 — 앱 레벨 백업

### 일일 작동 확인

```bash
# 고객 VM
ssh toweradmin@<vm-ip> "ls -lh ~/backups/ | tail -10 && tail -20 ~/backups/backup.log"

# 본 서버
ls -lh /home/enterpriseai/backups/ | tail -10
tail -20 /home/enterpriseai/backups/backup.log
```

정상이면 매일 새로운 `YYYYMMDD_HHMMSS/` 디렉토리 + `postgres.dump`, `workspace.tar.gz`, `claude.tar.gz`, `env.backup`, `MANIFEST.txt` 5개 파일이 보입니다.

### 수동 백업

```bash
# 표준 (워크스페이스 포함)
bash ~/tower/scripts/backup.sh

# 워크스페이스 제외 (본 서버처럼 큰 경우)
BACKUP_WORKSPACE=0 BACKUP_CLAUDE=1 bash ~/tower/scripts/backup.sh

# 임시 위치
bash ~/tower/scripts/backup.sh /tmp/manual-backup
```

### 복구 — PostgreSQL

```bash
# 1. 가장 최근 dump 선택
LATEST=$(ls -td ~/backups/*/ | head -1)
echo "복구할 dump: ${LATEST}postgres.dump"

# 2. 백엔드 정지 (작업 컨텍스트 보호)
pm2 stop tower-prod   # 고객 VM
# 또는 본 서버: backend 작업 중이라면 세션 정리 후 진행

# 3. DB 복구 (옵션 A: 통째 교체)
DATABASE_URL=$(grep ^DATABASE_URL ~/tower/.env | cut -d= -f2-)
pg_restore --clean --if-exists -d "$DATABASE_URL" "${LATEST}postgres.dump"

# 4. 백엔드 재시작
pm2 restart tower-prod   # 고객 VM
```

### 복구 — Workspace 단일 파일

```bash
LATEST=$(ls -td ~/backups/*/ | head -1)
# 특정 파일만 추출
tar -xzf "${LATEST}workspace.tar.gz" -C /tmp workspace/projects/foo/bar.md
# 원하는 위치로 이동
cp /tmp/workspace/projects/foo/bar.md ~/workspace/projects/foo/
```

### 복구 — .env 분실 시

```bash
LATEST=$(ls -td ~/backups/*/ | head -1)
cp "${LATEST}env.backup" ~/tower/.env
chmod 600 ~/tower/.env
pm2 restart tower-prod
```

---

## 3. Layer 2 — Azure Recovery Services Vault

### Vault 정보

| 항목 | 값 |
|---|---|
| Vault | `tower-backup-koreacentral` |
| Resource Group | `tower_customers` |
| Region | koreacentral |
| Storage | GRS (Geo-Redundant) |
| Policy | `DefaultPolicy` (Daily, 30-day retention, 00:30 KST) |

### 등록 상태 확인

```bash
az backup item list \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --query "[].{name:properties.friendlyName, status:properties.protectionStatus, lastBackup:properties.lastBackupStatus}" \
  -o table
```

### 백업 작업 이력

```bash
az backup job list \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --query "[?starts_with(properties.startTime, '$(date -u +%Y-%m-%d)')].{vm:properties.entityFriendlyName, op:properties.operation, status:properties.status, start:properties.startTime}" \
  -o table
```

### 즉시 백업 (정책 외 수동 트리거)

```bash
RETAIN_UNTIL=$(date -u -d "+30 days" +"%d-%m-%Y")
az backup protection backup-now \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --container-name <vm-name> \
  --item-name <vm-name> \
  --backup-management-type AzureIaasVM \
  --retain-until "$RETAIN_UNTIL"
```

### VM 복원 (재해 복구)

#### 옵션 A: 새 VM으로 복원 (안전, 권장)

```bash
# 1. 복원 지점 목록
az backup recoverypoint list \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --container-name <vm-name> \
  --item-name <vm-name> \
  --backup-management-type AzureIaasVM \
  --query "[].{id:name, time:properties.recoveryPointTime}" \
  -o table

# 2. 새 VM으로 복원 (RP_ID는 위에서 선택)
az backup restore restore-disks \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --container-name <vm-name> \
  --item-name <vm-name> \
  --backup-management-type AzureIaasVM \
  --rp-name <RP_ID> \
  --storage-account <복원용 storage account> \
  --target-resource-group tower_customers
```

#### 옵션 B: 기존 VM 디스크 교체 (위험)

운영 중인 VM의 디스크를 통째 교체. 반드시 사용자 확인 후 진행.

```bash
az backup restore restore-disks \
  --resource-group tower_customers \
  --vault-name tower-backup-koreacentral \
  --container-name <vm-name> \
  --item-name <vm-name> \
  --backup-management-type AzureIaasVM \
  --rp-name <RP_ID> \
  --restore-mode OriginalLocation \
  --storage-account <storage account>
```

---

## 4. 신규 고객 VM 추가 절차 (managed 티어 전용)

> standalone 고객은 이 절차를 적용하지 않는다. 고객 자체 백업을 사용하거나, 별도 합의에 따라 가이드(`backup.sh` 사용법)만 전달.

```steps
1. VM 프로비저닝 (Azure CLI 또는 포털)
2. bootstrap-prod.sh 실행 — **반드시 `--tier managed`**
   → backup.sh cron 자동 등록 (0 3 * * *)
   → Neko 등 managed 전용 컴포넌트 함께 설치
3. Azure Backup Vault 등록 (수동, az CLI):
   az backup protection enable-for-vm \
     --resource-group tower_customers \
     --vault-name tower-backup-koreacentral \
     --vm /subscriptions/.../virtualMachines/<vm-name> \
     --policy-name DefaultPolicy
4. ~/.claude/skills/library/library.yaml `customers:` 섹션에 항목 추가
   (azure.backup_enrolled: true, backup_layer1_cron: true 표기)
5. 첫 백업 즉시 트리거 (위 "즉시 백업" 명령)
6. 24시간 후 재확인 — Layer 1 ~/backups/, Layer 2 az backup item list
```

---

## 5. 모니터링 / 알림 (TODO)

- [ ] Azure Backup 실패 시 Slack/이메일 자동 알림 (Action Group 미구성)
- [ ] Layer 1 backup.log를 auto-selfheal-prod.sh에서 파싱해 실패 감지
- [ ] 백업 사이즈 추세 대시보드 (월별 증가율)

## 6. 분기별 복구 리허설

분기 1회, 다음 절차로 실제 복구를 검증하고 결과를 기록한다:

1. demo-tower 같은 비활용 VM에서 복원 테스트
2. 복원된 VM 부팅 → tower 서비스 정상 기동 확인 → DB 무결성 확인
3. 결과를 `workspace/docs/backup-recovery-rehearsal-YYYY-Q.md`에 기록

## 6.5. 본 서버 (openclaw-vm, full) 운영 절차

본 서버는 VM Vault 미사용. 데이터만 off-site Blob 보호.

### 일일 작동 확인

```bash
# 로컬
ls -lh /home/enterpriseai/backups/ | tail -5
tail -20 /home/enterpriseai/backups/backup.log

# Blob (PG + .claude + .env)
az storage blob list --account-name towerworkspacebackup \
  --container-name tower-data-backup --auth-mode login \
  --query "[].{name:name, size_mb:properties.contentLength}" -o table

# Blob (workspace, backup-to-blob.sh가 별도 처리)
az storage blob list --account-name towerworkspacebackup \
  --container-name workspace-backup --auth-mode login \
  --query "[?starts_with(name, '$(date +%Y-%m)')]" -o table | head
```

### 복구 — Blob에서 PG dump 받기

```bash
# 최신 백업 위치 찾기
LATEST=$(az storage blob list --account-name towerworkspacebackup \
  --container-name tower-data-backup --auth-mode login \
  --prefix "openclaw-vm/" --query "[?ends_with(name, 'postgres.dump')] | [-1].name" -o tsv)
echo "최신 dump: $LATEST"

# 다운로드
az storage blob download --account-name towerworkspacebackup \
  --container-name tower-data-backup --auth-mode login \
  --name "$LATEST" --file /tmp/postgres.dump

# 복원 (DATABASE_URL은 .env에서)
DATABASE_URL=$(grep ^DATABASE_URL /home/enterpriseai/tower/.env | cut -d= -f2-)
pg_restore --clean --if-exists -d "$DATABASE_URL" /tmp/postgres.dump
```

### 본 서버 통째 재구축 (디스크 손실 시)

```steps
1. 새 Azure VM 프로비저닝 (koreacentral, B2ms 이상, 128GB+ 디스크)
2. 같은 host에 git clone tower
3. bash scripts/azure/bootstrap-prod.sh --tier full (workspace는 별도 복원)
4. Blob에서 최신 .env, PG dump, .claude tar 다운로드 → 복원
5. workspace는 backup-to-blob.sh 컨테이너에서 최신 tar.gz 받아 압축 해제
6. PM2 시작 + 도메인 DNS 갱신
```

---

## 7. 알려진 제약

- **본 서버 workspace 8GB+** → Layer 1에서는 tar 생략 (`BACKUP_WORKSPACE=0`).
  `workspace/scripts/backup-to-blob.sh` (별도 Azure Blob 백업)에 위임.
  단, 최근 로그에 mid-write tar 오류 발생 → 별도 수정 필요.
- **본 서버 (tower-ai-rg, eastus2)** Vault 미생성 — VM 스냅샷 미등록 상태.
  필요 시 `tower-backup-eastus2` Vault 별도 생성.
- **Azure Sponsorship 한도** — 백업 스토리지 누적 시 한도 모니터링 필요.
