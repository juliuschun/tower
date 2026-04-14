# Azure 고객용 Tower 배포 런북 (Runbook)

> 실전 배포 경험(okusystem, 2026-04-04)에서 배운 내용을 정리한 문서.
> 다음 고객 배포 시 이 문서를 따르면 된다.

---

## 배포 전 의사결정 체크리스트

고객과 아래 항목을 **먼저 확정**한 후 시작한다.

| # | 항목 | 예시 (okusystem) | 비고 |
|---|------|-----------------|------|
| 1 | resource_group | `tower_customers` | 고객별 분리 or 공유 RG |
| 2 | vm_name | `okusystem` | 고객사 이름 권장 |
| 3 | location | `koreacentral` | Azure CLI 표기 (`korea central` ✕) |
| 4 | admin_user | `toweradmin` | ⚠️ `admin` 불가 (Azure 예약어) |
| 5 | domain | `okusystem.moatai.app` | 서브도메인 or 고객 자체 도메인 |
| 6 | ssl_mode | `certbot` | certbot or cloudflare |
| 7 | data_migration | `code-only` | code-only / workspace 포함 / DB+workspace 전체 |
| 8 | repo_access | `rsync` (초기) → `gh` (이후) | GitHub 인증은 나중에 별도 |

---

## VM 사이즈 가이드

### 실측 기반 리소스 소비 (moatai.app 운영 서버)

| 컴포넌트 | RAM | CPU | 디스크 |
|----------|-----|-----|--------|
| Tower PM2 (tower-prod) | ~200MB | ~0% idle | - |
| Claude CLI 세션 1개 | ~350MB | 2~8% active | - |
| .claude/ (세션 jsonl) | - | - | 2.8GB (3개월) |
| workspace/ (프로젝트 파일) | - | - | 13GB (3개월) |
| node_modules | - | - | ~750MB |
| tower 코드 + dist | - | - | ~1.2GB |

### 권장 스펙

| 용도 | VM Size | vCPU | RAM | 디스크 | 월비용 |
|------|---------|------|-----|--------|--------|
| 1~2명 소규모 | Standard_B2ms | 2 | 8GB | 128GB | ~$60 |
| 3~5명 팀 | Standard_B4ms | 4 | 16GB | 128GB | ~$120 |
| 10명+ | Standard_B8ms | 8 | 32GB | 256GB | ~$240 |

### 핵심 교훈

- **디스크 30GB는 절대 부족** → 최소 128GB. `.claude/`와 `workspace/`가 계속 커짐
- **RAM 4GB는 동시 세션 2개에서 OOM 위험** → 최소 8GB
- **Swap 필수** → 4GB 권장. Azure 기본 VM은 swap 0
- **B2s → B2ms 업그레이드는 VM 재시작 필요** (deallocate → resize → start, ~3분)
- 디스크 확장은 **deallocated 상태에서만 가능** (running 상태에서 안 됨)

---

## 실전 배포 순서

### Phase 1: VM 생성 + 스펙 설정

```bash
# 1) VM 생성
bash scripts/azure/create-vm.sh \
  --resource-group tower_customers \
  --location koreacentral \
  --vm-name <CUSTOMER> \
  --admin-user toweradmin \
  --size Standard_B2ms

# 2) NSG 포트 충돌 대응
#    create-vm.sh가 포트 22를 두 번 열면서 충돌 에러가 남.
#    VM 생성 시 SSH(22)가 자동으로 열리기 때문.
#    → 무시하고, 80/443만 수동으로 열면 됨:
az network nsg rule create --resource-group tower_customers \
  --nsg-name <CUSTOMER>NSG \
  --name allow-http --priority 1010 \
  --destination-port-ranges 80 --access Allow --protocol Tcp --direction Inbound -o none

az network nsg rule create --resource-group tower_customers \
  --nsg-name <CUSTOMER>NSG \
  --name allow-https --priority 1020 \
  --destination-port-ranges 443 --access Allow --protocol Tcp --direction Inbound -o none
```

> **학습**: `az vm create`가 SSH용 NSG 규칙 `default-allow-ssh`를 자동 생성한다.
> `create-vm.sh`에서 포트 22를 또 열면 priority 1000 충돌.
> **수정 방안**: 스크립트에서 포트 22 오픈을 제거하거나, 이미 존재하면 skip하는 로직 추가.

### Phase 2: VM 스펙 업그레이드 (필요 시)

초기에 B2s로 만들었다면:

```bash
# VM 중지
az vm deallocate --resource-group tower_customers --name <CUSTOMER>

# 디스크 확장 (deallocated 상태에서만 가능)
DISK_NAME=$(az disk list --resource-group tower_customers --query '[0].name' -o tsv)
az disk update --resource-group tower_customers --name "$DISK_NAME" --size-gb 128

# VM 사이즈 변경
az vm resize --resource-group tower_customers --name <CUSTOMER> --size Standard_B2ms

# VM 시작
az vm start --resource-group tower_customers --name <CUSTOMER>
```

> **학습**: `az disk update`는 VM이 running이어도 에러, deallocated여도 에러 메시지가 나올 수 있다.
> 그런데 실제로는 적용된다 (tier가 P4→P10으로 변경됨). `sizeGb`가 null로 표시되지만 `tier: P10` = 128GB.

### Phase 3: 런타임 설치

```bash
VM_IP=<PUBLIC_IP>
VM_USER=toweradmin

# 타임존 KST 설정 (Azure 기본 = UTC)
ssh $VM_USER@$VM_IP 'sudo timedatectl set-timezone Asia/Seoul'

# 기본 패키지
ssh $VM_USER@$VM_IP 'sudo apt update && sudo apt upgrade -y && \
  sudo apt install -y curl ca-certificates gnupg lsb-release unzip jq \
  build-essential python3 git nginx'

# Node.js 20
ssh $VM_USER@$VM_IP 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && \
  sudo apt install -y nodejs'

# PM2 + Claude CLI
ssh $VM_USER@$VM_IP 'sudo npm install -g pm2 @anthropic-ai/claude-code'

# Swap 추가 (Azure 기본 = 0)
ssh $VM_USER@$VM_IP 'sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && \
  sudo mkswap /swapfile && sudo swapon /swapfile && \
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab'

# 검증
ssh $VM_USER@$VM_IP 'node -v && pm2 -v && claude --version && free -h | grep Swap'
```

### Phase 4: 코드 배치

```bash
# rsync (GitHub 인증 불필요, 가장 빠름)
rsync -avz --exclude node_modules --exclude dist --exclude .git --exclude .env --exclude uploads \
  /home/enterpriseai/tower/ $VM_USER@$VM_IP:~/tower/

# ⚠️ notify-hub도 별도 복사 필요 (file: 링크 의존성)
rsync -avz --exclude .git ~/notify-hub/ $VM_USER@$VM_IP:~/notify-hub/

# npm install
ssh $VM_USER@$VM_IP 'cd ~/tower && npm install'
```

> **학습**: `notify-hub`는 `packages/backend/package.json`에 `"file:../../../notify-hub"`로 참조됨.
> rsync에서 빠지면 빌드는 되지만 TS 에러 발생. **반드시 함께 복사할 것.**

### Phase 5: 설정

```bash
# .env 생성
JWT_SECRET=$(openssl rand -hex 32)
ssh $VM_USER@$VM_IP "cat > ~/tower/.env << EOF
PORT=32364
HOST=0.0.0.0
WORKSPACE_ROOT=/home/$VM_USER/workspace
DEFAULT_CWD=/home/$VM_USER/workspace
JWT_SECRET=$JWT_SECRET
PERMISSION_MODE=bypassPermissions
MAX_CONCURRENT_SESSIONS=10
GIT_AUTO_COMMIT=true
DB_PATH=data/tower.db
PUBLIC_URL=https://<DOMAIN>
EOF"

# ecosystem.config.cjs의 PUBLIC_URL 변경
ssh $VM_USER@$VM_IP 'sed -i "s|https://tower.moatai.app|https://<DOMAIN>|g" ~/tower/ecosystem.config.cjs'

# workspace 준비
ssh $VM_USER@$VM_IP 'mkdir -p ~/workspace && cp -r ~/tower/templates/workspace/* ~/workspace/'
```

### Phase 6: 빌드 + 기동

```bash
# 빌드
ssh $VM_USER@$VM_IP 'cd ~/tower && npm run build'

# PM2 시작 (start.sh가 원격 SSH에서 잘 안 먹힐 수 있음 → 직접 PM2 명령 사용)
ssh $VM_USER@$VM_IP 'cd ~/tower && pm2 start ecosystem.config.cjs --only tower-prod'

# 검증
ssh $VM_USER@$VM_IP 'pm2 list && curl -s http://127.0.0.1:32364/api/health'
```

> **학습**: `./start.sh prod-start`는 SSH 원격 실행 시 cooldown 체크 등에서 문제가 생길 수 있다.
> `pm2 start ecosystem.config.cjs --only tower-prod`를 직접 사용하는 것이 더 확실하다.

### Phase 7: nginx

```bash
DOMAIN=<DOMAIN>
ssh $VM_USER@$VM_IP "sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null << 'NGINXEOF'
server {
    client_max_body_size 50m;
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:32364;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ && \
sudo nginx -t && sudo systemctl reload nginx"
```

### Phase 8: DNS + HTTPS

**DNS 먼저** (사람이 해야 함):
- Cloudflare/DNS 관리자에서 A 레코드 추가: `<subdomain>` → `<VM_IP>`
- **certbot 사용 시 Cloudflare Proxy OFF** (회색 구름)

**certbot 설치 + 인증서 발급:**
```bash
ssh $VM_USER@$VM_IP "sudo apt install -y certbot python3-certbot-nginx && \
  sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m support@moatai.io"
```

**HTTPS 적용 후 Cloudflare Proxy ON 가능** (원한다면 Full Strict 모드로).

### Phase 9: Claude 인증

```bash
# 방법 A: 기존 서버에서 credentials 복사
scp ~/.claude/.credentials.json $VM_USER@$VM_IP:~/.claude/.credentials.json

# 방법 B: API 키 사용 (.env에 추가)
ssh $VM_USER@$VM_IP 'echo "ANTHROPIC_API_KEY=sk-ant-..." >> ~/tower/.env'

# 방법 C: 직접 로그인 (브라우저 필요)
ssh $VM_USER@$VM_IP 'claude auth login'
```

### Phase 10: 스킬 배포 (Library Profile)

스킬은 `~/.claude/skills/library/` 의 프로필 시스템으로 관리한다.
**절대 `install-skills.sh`를 직접 실행하지 말 것** (CPU 폭주 사고 이력).

```bash
# 1) 프로필 미리보기
bash ~/.claude/skills/library/deploy-profile.sh --dry-run customer-basic

# 2) 고객 레지스트리에 등록 후 배포 (library.yaml → customers: 섹션)
bash ~/.claude/skills/library/deploy-profile.sh --customer <CUSTOMER>

# 3) 또는 직접 지정
bash ~/.claude/skills/library/deploy-profile.sh customer-basic $VM_USER@$VM_IP

# 4) PM2 재시작 (스킬 로드 반영)
ssh $VM_USER@$VM_IP 'cd ~/tower && pm2 restart tower-prod --update-env'
```

**프로필 선택 기준:**

| 프로필 | 스킬 수 | 대상 | 포함 태그 |
|--------|---------|------|-----------|
| core | 9 | 모든 고객 | 기획, 검색, 메모리 |
| customer-basic | 26 | 비개발 고객 (건설, 제조 등) | core + 비즈니스 + 문서 |
| customer-full | 33 | 기술력 있는 고객 | basic + 개발 도구 |
| internal | 40 | Moat AI 내부 | 전체 |

**새 고객 등록:**
`~/.claude/skills/library/library.yaml` → `customers:` 섹션에 추가:
```yaml
customers:
  new-customer:
    profile: customer-basic
    ssh: toweradmin@<IP>
    domain: new-customer.moatai.app
```

**스킬 업데이트 시:**
소스 서버(moatai.app)에서 스킬을 수정한 후, `deploy-profile.sh --customer <name>`을 다시 실행하면 rsync로 변경분만 동기화된다.

### Phase 11: 초기 데이터 정돈

배포 직후 프로젝트/세션 구조가 깨끗한 상태인지 확인한다.
이 단계를 건너뛰면 사용자가 만드는 세션이 "임시"로 빠지고, Files 탭에서 Common 아래에 프로젝트가 중복 노출되는 문제가 발생한다.

```bash
# 1) 타임존 확인 (Phase 3에서 설정했지만 재확인)
ssh $VM_USER@$VM_IP 'timedatectl | grep "Time zone"'
# → Asia/Seoul (KST, +0900) 이어야 함

# 2) 프로젝트-폴더 1:1 매칭 확인
ssh $VM_USER@$VM_IP 'ls ~/workspace/projects/'
# → DB의 projects 테이블 root_path와 1:1 대응해야 함.
#   폴더는 있는데 DB에 없으면 프로젝트 생성 필요.
#   DB에 있는데 폴더가 없으면 아카이브(archived=1) 처리.

# 3) 임시 세션 확인 (project_id가 NULL인 세션)
ssh $VM_USER@$VM_IP "PGPASSWORD=<DB_PASS> psql -U toweradmin -d tower -t -c \
  \"SELECT COUNT(*) FROM sessions WHERE project_id IS NULL AND parent_session_id IS NULL;\""
# → 0이어야 함. 0이 아니면 cwd 기반으로 프로젝트 재연결 필요.

# 4) 프로젝트 폴더명 정리
# Tower가 자동 생성하는 폴더는 project-<uuid8> 형태 (못생김).
# 의미 있는 영문 slug로 리네임하고 DB root_path도 함께 업데이트.
```

> **학습 (okusystem, 2026-04-14)**:
> - `project-2ca0f112` 같은 자동 생성 폴더명 → `shredder-plant`로 정돈
> - Common(가상 섹션)은 admin에게만 표시 (코드 패치 완료, 2026-04-14)
> - 세션 생성 시 projectId 자동 상속 로직 추가 (App.tsx 패치 완료, 2026-04-14)

### Phase 12: 운영 안정화

```bash
# PM2 부팅 자동시작
ssh $VM_USER@$VM_IP 'pm2 startup systemd -u toweradmin --hp /home/toweradmin && pm2 save'

# certbot 자동 갱신 확인
ssh $VM_USER@$VM_IP 'systemctl list-timers | grep certbot'

# 스모크 테스트
ssh $VM_USER@$VM_IP 'curl -s https://<DOMAIN>/api/health'
```

---

## 실전에서 겪은 이슈와 해결

### 1. `admin` 사용자명 거부

**증상**: Azure VM 생성 시 `--admin-user admin` 거부
**원인**: Azure가 `admin`, `root`, `administrator` 등을 예약어로 차단
**해결**: `toweradmin` 같은 커스텀 이름 사용
**예방**: 고객과 사전 합의 시 admin 외의 이름 제안

### 2. NSG 포트 22 충돌

**증상**: `SecurityRuleConflict: Security rule default-allow-ssh conflicts with rule open-port-22`
**원인**: `az vm create`가 SSH용 규칙을 자동 생성 (priority 1000) → 스크립트가 같은 priority로 재생성 시도
**해결**: 포트 22 오픈 skip, 80/443만 수동 추가
**예방**: `create-vm.sh`에서 기존 규칙 존재 여부 확인 로직 추가 필요

### 3. 디스크 30GB 부족

**증상**: 배포 직후엔 괜찮지만 1~2개월 후 디스크 풀
**원인**: `.claude/` 세션 파일 + `workspace/` 프로젝트 파일이 계속 증가
**해결**: 128GB로 확장 (deallocate → disk update → start)
**예방**: 처음부터 128GB로 생성. B2ms가 기본 디스크 30GB이므로 `--os-disk-size-gb 128` 옵션 사용

### 4. notify-hub 누락으로 빌드 에러

**증상**: `Cannot find module 'notify-hub' or its corresponding type declarations`
**원인**: `packages/backend/package.json`에 `"notify-hub": "file:../../../notify-hub"` — 외부 폴더 참조
**해결**: `~/notify-hub/`도 함께 rsync
**예방**: rsync 체크리스트에 notify-hub 포함. 장기적으로는 npm 패키지로 분리 권장

### 5. `./start.sh prod-start` 원격 실행 실패

**증상**: SSH 원격에서 start.sh 실행 시 cooldown/빌드 단계에서 멈춤
**원인**: start.sh 내부 로직이 대화형(interactive) 가정
**해결**: `pm2 start ecosystem.config.cjs --only tower-prod` 직접 사용
**예방**: 원격 배포 시에는 PM2 명령 직접 사용 권장

### 6. `az disk update` sizeGb null 표시

**증상**: 디스크 확장 후 `sizeGb: null` 표시 → 실패인지 불확실
**원인**: Azure CLI 출력 버그. 실제로는 tier가 변경됨 (P4→P10 = 128GB)
**해결**: `az disk show`로 tier 확인 (P10 = 128GB)
**예방**: tier로 검증

### 7. PostgreSQL 미설치 → 인증 우회

**증상**: 로그인/회원가입 화면 없이 바로 접속됨
**원인**: `hasUsers()` → PG 쿼리 → `DATABASE_URL` 미설정 → 에러 → 프론트 fallback으로 인증 스킵
**해결**: PostgreSQL 설치 + DATABASE_URL 추가 + PM2 재시작
**예방**: PostgreSQL은 필수 의존성. 배포 Phase 3(런타임)에서 함께 설치할 것

### 8. migrations 디렉토리 dist에 없음

**증상**: `[pg] No migrations directory found — skipping.` → 테이블 미생성
**원인**: TypeScript 빌드(tsc)가 .sql 파일을 dist/에 복사하지 않음
**해결**: `cp -r packages/backend/db/migrations dist/backend/packages/backend/db/migrations`
**예방**: 빌드 후 자동 복사 스크립트 추가 (package.json postbuild 또는 start.sh에 포함)

---

## 배포 완료 후 체크리스트

- [ ] `tower-prod` PM2 online
- [ ] `/api/health` 응답 정상
- [ ] 브라우저 접속 + 첫 관리자 계정 생성
- [ ] WebSocket 연결 (`Ready` 상태)
- [ ] 채팅 테스트 (Claude 응답 수신)
- [ ] Files 탭에서 workspace 표시
- [ ] HTTPS 인증서 유효
- [ ] PM2 부팅 자동시작 등록
- [ ] 백업 cron 설정

---

## 소요 시간 (실측)

| 단계 | 소요 시간 |
|------|----------|
| VM 생성 + NSG | ~3분 |
| VM 리사이즈 (B2s→B2ms) | ~3분 (deallocate 포함) |
| 기본 패키지 설치 | ~3분 |
| Node + PM2 + Claude CLI | ~2분 |
| rsync 코드 복사 (tower + notify-hub) | ~1분 |
| npm install | ~2분 |
| npm run build | ~30초 |
| nginx 설정 | ~30초 |
| DNS 전파 대기 | 1~5분 (Cloudflare 즉시) |
| certbot | ~1분 |
| **총 소요** | **~20분** (DNS 대기 제외) |

---

## 배포된 고객 VM 레지스트리

| 고객 | VM Name | IP | 도메인 | RG | 스펙 | 배포일 | 비고 |
|------|---------|-----|--------|-----|------|--------|------|
| okusystem | okusystem | 20.41.101.188 | okusystem.moatai.app | tower_customers | B2ms/8GB/128GB | 2026-04-04 | 첫 고객, certbot, PG 로컬 |

### 9. 서버 타임존 UTC → 세션 시간 혼란

**증상**: 세션명에 표시되는 시간이 한국 시간과 9시간 차이
**원인**: Azure VM 기본 타임존이 UTC
**해결**: `sudo timedatectl set-timezone Asia/Seoul`
**예방**: Phase 3(런타임)에서 첫 번째로 설정. 런북에 추가 완료

### 10. 세션이 "임시"로 분류됨

**증상**: 새 세션이 프로젝트 대신 "임시" 섹션으로 들어감
**원인**: `createSessionInDb()`에서 projectId를 넘기지 않으면, cwd가 workspace 루트 → 어떤 프로젝트에도 매칭 안 됨
**해결**: App.tsx 패치 — 활성 세션 → 최근 세션 순으로 projectId 자동 상속 (2026-04-14)
**예방**: 코드 배포 시 자동 적용. 초기 배포 후 Phase 11에서 검증

### 11. Common 섹션에 프로젝트 폴더 중복 노출

**증상**: Files 탭 → Common 아래에 projects/ 폴더가 보이고, 각 프로젝트가 중복 표시
**원인**: Common의 rootPath가 workspace 전체를 가리킴
**해결**: Common을 admin에게만 표시 (Sidebar.tsx 패치, 2026-04-14)
**예방**: 코드 배포 시 자동 적용

### 12. 프로젝트 폴더명이 project-<hash> 형태

**증상**: workspace/projects/ 아래 폴더가 `project-2ca0f112` 같은 무의미한 이름
**원인**: Tower 프로젝트 생성 시 slug를 `project-<uuid 앞 8자리>`로 자동 생성
**해결**: 배포 후 Phase 11에서 의미 있는 영문명으로 리네임 + DB root_path 업데이트
**예방**: 장기적으로 프로젝트 생성 시 이름 기반 slug 자동 생성 로직 개선 필요

---

## 향후 개선 사항

1. **create-vm.sh NSG 중복 방지**: 포트 22 규칙 존재 확인 후 skip
2. **VM 생성 시 디스크 사이즈 옵션 추가**: `--os-disk-size-gb 128`
3. **notify-hub를 npm 패키지로 분리**: file: 링크 의존 제거
4. **원클릭 배포 스크립트 통합**: create-vm → resize → bootstrap 하나로
5. **Claude 인증 자동화**: credentials 복사 또는 API 키 주입 표준화
6. **고객별 workspace 템플릿**: 업종별 초기 CLAUDE.md / skills 세트
7. **PostgreSQL을 기본 설치에 포함**: 인증이 PG 의존이므로 필수
8. **빌드 후 migrations 자동 복사**: postbuild 스크립트 추가
9. **`pm2 restart --update-env` 기본 사용**: .env 변경 후 restart 시 환경변수 반영 안 되는 이슈 방지

---

*최초 작성: 2026-04-04 (okusystem 배포)*
*다음 배포 시 이 문서를 업데이트할 것*
