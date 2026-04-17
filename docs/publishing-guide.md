# Publishing Guide — 사이트 배포 & 도메인 관리

> Tower를 통한 사이트/앱 배포 전체 가이드.
> 운영자(Moat AI)와 고객 서버 관리자 모두를 위한 문서.

---

## 개요

Tower는 두 가지 모드로 사이트를 배포합니다 (구 "로컬 서빙 모드"는 현재 미동작 — 아래 경고 참조):

| 모드 | 설명 | 배포 경로 | 도메인 |
|------|------|----------|--------|
| **서브도메인** *(현재 사용)* | 와일드카드 DNS + nginx로 전용 URL | `workspace/published/sites/` | `이름.고객.moatai.app` |
| **외부 배포** | Cloudflare Pages / Azure | Gateway 경유 | `이름.pages.dev` 또는 커스텀 |

> ⚠️ **`서버도메인/sites/이름/` (로컬 서빙) 모드는 현재 okusystem nginx에 활성화되어 있지 않습니다.**
> okusystem.moatai.app은 모든 `/` 경로를 Tower 백엔드(:32364)로 프록시하므로
> `/sites/*` URL은 Tower SPA로 가버리고 사이트 파일이 노출되지 않습니다.
> 사용자에게 안내할 URL은 항상 서브도메인(`이름.okusystem.moatai.app`) 형태여야 합니다.
> 로컬 서빙 모드를 같이 살리려면 `okusystem.moatai.app` 서버 블록에
> `location /sites/ { alias /home/toweradmin/workspace/published/sites/; ... }`를 추가해야 합니다.

### 사이트가 어떻게 보이는가

```
# 서브도메인 (정답, Phase 4 — 현재 사용)
https://monthly-report.okusystem.moatai.app/

# 외부 배포 (Gateway)
https://okusystem--monthly-report.pages.dev/

# (참고) 구 로컬 서빙 모드 — 현재 okusystem에서는 동작하지 않음
# https://okusystem.moatai.app/sites/monthly-report/
```

서브도메인·외부 배포 모두 같은 파일(`workspace/published/sites/monthly-report/`)을 기반으로 합니다.

---

## 1. 사이트 만들기 (서브도메인)

### 사이트 만들기

Tower 채팅에서 AI에게 요청하면 됩니다:

```
"우리 팀 월간 보고서를 웹 페이지로 만들어줘"
```

AI가 HTML/CSS/JS 파일을 `workspace/published/sites/monthly-report/` 폴더에 생성합니다.

### 접근 방법

와일드카드 nginx 서버 블록이 서브도메인을 폴더에 매핑합니다:
```
https://monthly-report.okusystem.moatai.app/
```

별도 설정 불필요. 폴더에 파일을 넣으면 바로 접근 가능합니다.

> 참고: `https://okusystem.moatai.app/sites/monthly-report/` 형태(구 로컬 서빙 모드)는
> 현재 okusystem nginx에 활성화되어 있지 않습니다. 위 개요 섹션의 경고를 참조하세요.

### 사이트 삭제

폴더를 삭제하면 끝:
```bash
rm -rf workspace/published/sites/monthly-report/
```

---

## 2. 서브도메인 (와일드카드 DNS)

### 작동 원리

```
https://monthly-report.okusystem.moatai.app/
        ↓
DNS: *.okusystem.moatai.app → 20.41.101.188 (VM IP)
        ↓
nginx: server_name ~^(?<site>.+)\.okusystem\.moatai\.app$
        ↓
root: workspace/published/sites/$site/
        ↓
파일: workspace/published/sites/monthly-report/index.html
```

### 사전 설정 (한 번만)

이 설정은 고객 온보딩 시 Moat AI가 진행합니다:

1. **와일드카드 DNS** — `*.고객.moatai.app → VM IP`
2. **와일드카드 SSL** — certbot DNS-01 챌린지
3. **nginx 서버 블록** — 서브도메인 → sites 폴더 매핑

### 새 사이트 추가

설정 완료 후에는 **폴더만 만들면 끝**:
```bash
mkdir -p workspace/published/sites/새사이트/
echo '<h1>Hello</h1>' > workspace/published/sites/새사이트/index.html
```
→ 즉시 `https://새사이트.okusystem.moatai.app/` 접근 가능.

nginx 재시작 불필요. DNS 추가 불필요. **폴더 이름 = 서브도메인**.

### 이름 규칙

- 소문자 영어 + 숫자 + 하이픈만 (`a-z`, `0-9`, `-`)
- 시작은 영어/숫자 (`-`로 시작 불가)
- 예: `monthly-report`, `team-wiki`, `product-demo`

---

## 3. Gateway 배포 (외부 CDN)

### managed 모드 (고객 서버)

고객 서버(`TOWER_ROLE=managed`)에서 배포를 요청하면:

```
고객 Tower → tar.gz 패키징 → POST to Gateway → Cloudflare Pages 배포
```

고객은 Cloudflare 계정/키가 필요 없습니다. Moat AI의 중앙 Gateway가 대신 배포합니다.

### full 모드 (내부 서버)

Moat AI 서버(`TOWER_ROLE=full`)에서는 직접 배포:

```
Tower → deploy-engine.ts → Cloudflare Pages / Azure Container Apps
```

---

## 인프라 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│ Cloudflare (DNS + Pages)                                 │
│                                                          │
│  DNS:                                                    │
│    tower.moatai.app      → CF Proxy → Moat AI VM        │
│    okusystem.moatai.app  → 20.41.101.188 (직접)          │
│    *.okusystem.moatai.app → 20.41.101.188 (와일드카드)    │
│                                                          │
│  Pages:                                                  │
│    okusystem--report.pages.dev (Gateway 배포)             │
│                                                          │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ okusystem VM (20.41.101.188)                             │
│                                                          │
│  nginx:                                                  │
│    okusystem.moatai.app → Tower Backend (:32364)         │
│    *.okusystem.moatai.app → published/sites/$site/       │
│                                                          │
│  SSL:                                                    │
│    Let's Encrypt 와일드카드 (DNS-01, auto-renewal)        │
│                                                          │
│  파일:                                                    │
│    ~/workspace/published/sites/                           │
│      ├── monthly-report/index.html                       │
│      ├── team-wiki/index.html                            │
│      └── product-demo/index.html                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 운영자 가이드 (Moat AI)

### 신규 고객 도메인 설정

1. **DNS 자동 설정** (API로):
```bash
# Gateway API 사용
curl -X POST /api/gateway/customers/:id/setup-dns \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"ip": "고객VM_IP"}'
```

2. **고객 VM에 nginx + SSL 설정** (SSH로):
```bash
# certbot 와일드카드 인증서 발급
ssh toweradmin@$IP "sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d '고객.moatai.app' -d '*.고객.moatai.app' \
  --non-interactive --agree-tos --email admin@moatai.app"

# nginx 와일드카드 서버 블록 (한 번만 설정)
# → docs/plans/2026-04-13-phase4-domains-monitoring.md 참고
```

3. **DNS 상태 확인**:
```bash
curl /api/gateway/customers/:id/dns -H "Authorization: ..."
# → { status: "ready", wildcardRecord: {...}, baseRecord: {...} }
```

### SSL 인증서 갱신

certbot이 자동 갱신합니다. 수동 확인:
```bash
ssh toweradmin@$IP "sudo certbot certificates"
ssh toweradmin@$IP "sudo certbot renew --dry-run"
```

### 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 서브도메인 접속 불가 (DNS 에러) | 와일드카드 DNS 미설정 | `setup-dns` API 호출 |
| 서브도메인 접속 불가 (Connection refused) | nginx 설정 누락 | 와일드카드 서버 블록 추가 |
| SSL 에러 | 인증서 미발급 또는 만료 | certbot 재발급 |
| 403 Forbidden | 파일 퍼미션 | `chmod 711 /home/toweradmin` |
| 404 Not Found | 사이트 폴더 없음 | `ls workspace/published/sites/` 확인 |

---

## 고객 가이드 (managed 서버 사용자)

### "사이트를 만들고 싶어요"

Tower 채팅에서 AI에게 말하면 됩니다:

```
"제품 소개 페이지를 만들어줘"
"팀 대시보드를 웹으로 만들어줘"
"이 마크다운을 예쁜 웹페이지로 변환해줘"
```

AI가 파일을 생성하고 publish하면 전용 도메인으로 접근합니다:

- **전용 도메인**: `https://제품소개.okusystem.moatai.app/`
- (구 `okusystem.moatai.app/sites/제품소개/` 형태는 현재 nginx에서 SPA로 라우팅되므로 안내 금지)

### "사이트를 수정하고 싶어요"

```
"제품소개 페이지에 가격표를 추가해줘"
"대시보드 색상을 파란색으로 바꿔줘"
```

AI가 파일을 수정하면 즉시 반영됩니다. 별도 배포 과정이 없습니다.

### "사이트 목록을 보고 싶어요"

Tower 사이드바 → Publishing Hub 아이콘 클릭

또는 채팅에서:
```
"현재 배포된 사이트 목록 보여줘"
```

### "외부에 공개하고 싶어요" (CDN 배포)

Tower 채팅에서:
```
"제품소개 페이지를 외부에 배포해줘"
```

Moat AI Gateway를 통해 Cloudflare Pages에 자동 배포됩니다.
별도 계정이나 설정은 필요 없습니다.

---

## AI를 위한 안내 (CLAUDE.md/AGENTS.md에 포함)

아래 내용은 managed 서버의 CLAUDE.md에 추가하여
AI가 publishing 관련 요청을 올바르게 처리하도록 합니다:

```markdown
## Publishing — 사이트 배포

사용자가 웹 페이지/사이트 생성을 요청하면:

1. `workspace/published/sites/사이트이름/` 폴더에 파일을 생성
2. 폴더 이름 = 서브도메인 (소문자 영문 + 숫자 + 하이픈만, 영문/숫자로 시작)
3. index.html은 필수

접근 URL (서브도메인만 안내):
- ✅ https://사이트이름.SERVER_DOMAIN/
- ❌ https://SERVER_DOMAIN/sites/사이트이름/  ← 현재 nginx에서 SPA로 라우팅, 사용 금지

주의:
- 폴더 이름은 소문자 영어 + 숫자 + 하이픈만 사용
- index.html이 없으면 404
- 기존 사이트 수정은 파일만 변경하면 즉시 반영
```

---

## 관련 문서

| 문서 | 위치 |
|------|------|
| Phase 4 설계 | `docs/plans/2026-04-13-phase4-domains-monitoring.md` |
| Gateway 아키텍처 | `docs/plans/arch_0413_publish-gateway-redesign.md` |
| 고객 서버 레지스트리 | `docs/customer-servers.md` |
| 배포 엔진 | `docs/deploy-engine.md` |
| 배포 런북 | `docs/azure-customer-deployment-runbook.md` |
