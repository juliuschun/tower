# Deploy Engine — Cloudflare Pages + Azure Container Apps

> Tower Publishing Hub의 외부 배포 엔진. AI가 코드를 만들면 자동으로 적절한 플랫폼에 배포합니다.

## 아키텍처

```
Tower AI → Deploy Engine → [코드 타입 감지]
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
           Cloudflare Pages      Azure Container Apps
           (정적 사이트)           (동적 앱/서버)
                    │                    │
                    ▼                    ▼
           *.pages.dev           *.azurecontainerapps.io
```

### 왜 이 구조인가?

기존에는 모든 사이트/앱이 Tower 서버 내부에서 실행됐습니다 (nginx + systemd).
이 방식은 PoC 수준에서는 괜찮지만, 앱이 늘어나면:

- 서버 리소스 경합
- 포트 충돌
- 보안 격리 없음
- 서버 장애 시 전체 다운

Deploy Engine은 **정적은 CDN으로, 동적은 격리된 컨테이너로** 보냄으로써 이 문제를 해결합니다.

## 사전 요구사항

### 1. Cloudflare (정적 사이트용)

```bash
# .env에 추가
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

**토큰 발급:**
1. https://dash.cloudflare.com/profile/api-tokens
2. Create Token → Custom Token
3. 필요한 권한:
   - **Cloudflare Pages** — Edit
   - **Account Settings** — Read
   - **User Details** — Read
   - **Memberships** — Read
4. Account ID: Workers & Pages 페이지 URL에서 확인

### 2. Azure CLI (동적 앱용)

```bash
# Azure CLI가 이미 설치/인증되어 있어야 합니다
az account show

# .env에 추가 (선택사항, 기본값 있음)
AZURE_RESOURCE_GROUP=MAAP-n8n-resources
AZURE_CONTAINER_ENV=moat-container-env
AZURE_REGISTRY=maapn8nacr.azurecr.io
AZURE_REGISTRY_NAME=maapn8nacr
```

**현재 인프라:**
- Container Registry: `maapn8nacr.azurecr.io` (Korea Central)
- Container Apps 환경: `moat-container-env`
- 기본 도메인: `*.ambitiousfield-148ffc1c.koreacentral.azurecontainerapps.io`

## API 엔드포인트

### POST /api/deploy — 배포 실행

```bash
curl -X POST https://tower.moatai.app/api/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-site",
    "sourceDir": "/home/enterpriseai/workspace/published/sites/my-site",
    "description": "내 사이트 설명"
  }'
```

**요청 파라미터:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | O | 프로젝트명 (소문자, 하이픈만) |
| `sourceDir` | string | O | 소스 디렉토리 절대 경로 |
| `target` | string | X | `cloudflare-pages` 또는 `azure-container-apps` (생략 시 자동 감지) |
| `port` | number | X | 컨테이너 포트 (동적 앱, 기본 3000) |
| `env` | object | X | 컨테이너 환경변수 `{"KEY": "value"}` |
| `description` | string | X | 앱 설명 |

**응답:**

```json
{
  "success": true,
  "target": "cloudflare-pages",
  "url": "https://my-site.pages.dev",
  "detectedType": "static",
  "duration": 3200
}
```

### POST /api/deploy/detect — 코드 타입 감지

```bash
curl -X POST https://tower.moatai.app/api/deploy/detect \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sourceDir": "/path/to/code"}'
```

**응답:**
```json
{
  "type": "static",
  "recommendedTarget": "cloudflare-pages"
}
```

### GET /api/deploy/list — 배포 목록

```bash
curl https://tower.moatai.app/api/deploy/list \
  -H "Authorization: Bearer $TOKEN"
```

### DELETE /api/deploy/:type/:name — 배포 삭제

```bash
# 사이트 삭제 (CF Pages 프로젝트도 삭제됨)
curl -X DELETE https://tower.moatai.app/api/deploy/site/my-site \
  -H "Authorization: Bearer $TOKEN"

# 앱 삭제 (Azure Container App도 삭제됨)
curl -X DELETE https://tower.moatai.app/api/deploy/app/my-api \
  -H "Authorization: Bearer $TOKEN"
```

## 코드 타입 자동 감지

Deploy Engine은 소스 디렉토리를 분석해서 정적/동적을 자동 판단합니다.

### 동적으로 판정되는 조건 (→ Azure Container Apps)

- `Dockerfile` 존재
- Express, Fastify, Koa, Hono 등 서버 프레임워크 import
- Flask, FastAPI, Django 등 Python 서버 import
- `createServer()`, `.listen(port)` 호출
- `package.json`에 `start` 스크립트 존재

### 정적으로 판정되는 조건 (→ Cloudflare Pages)

- 모든 파일이 HTML, CSS, JS, 이미지, 폰트, PDF 등 정적 확장자
- 서버 코드 패턴이 발견되지 않음

### Dockerfile 자동 생성

소스에 Dockerfile이 없으면 자동 생성:

- `requirements.txt` → Python 3.12 이미지
- `package.json` → Node 20 이미지
- 둘 다 없으면 → `serve`로 정적 서빙

## 현재 배포 현황

### 정적 사이트 (Cloudflare Pages)

| 사이트 | URL | 설명 |
|--------|-----|------|
| tower-landing | https://tower-landing.pages.dev | Tower 소개 페이지 |
| moatai-finance | https://moatai-finance.pages.dev | 세상의 돈이 어디로 흐르는지 |
| transformer-params | https://transformer-params.pages.dev | 트랜스포머 파라미터 원리 |
| ai-enterprise-guide | https://ai-enterprise-guide.pages.dev | 전사 AI 도입 MBA 특강 |

### 로컬 앱 (서버 내부, 기존)

| 앱 | 포트 | 설명 |
|----|------|------|
| hub | 32400 | Publishing Hub 대시보드 |
| edge-dashboard | 8377 | Polymarket edge 모니터링 |
| world-pulse | 8378 | 세계 확률 인포그래픽 |
| text2sql | 8501 | BNK 부산은행 Text2SQL 데모 |
| collector-dashboard | 8379 | 수집기 모니터링 |
| miroball | 5001 | 군중 지능 시뮬레이션 |

## manifest.json 스키마 확장

기존 manifest.json에 외부 배포 필드가 추가됐습니다:

```json
{
  "name": "my-site",
  "description": "...",
  "access": "public",
  "created_at": "2026-04-06T...",
  "deploy_target": "cloudflare-pages",     // 새 필드
  "external_url": "https://my-site.pages.dev",  // 새 필드
  "last_deployed_at": "2026-04-06T..."     // 새 필드
}
```

`deploy_target` 값:
- `cloudflare-pages` — CF Pages 배포
- `azure-container-apps` — Azure Container Apps 배포
- `local` — 서버 내부 실행 (기존)

## 파일 구조

```
packages/backend/
├── services/
│   └── deploy-engine.ts    # 핵심 엔진 (타입 감지, CF/Azure 배포, manifest 관리)
└── routes/
    └── api.ts              # /api/deploy/* 엔드포인트
```

## 향후 계획

- [ ] PublishPanel UI에서 외부 URL 표시 및 재배포 버튼
- [ ] 커스텀 도메인 연결 (CF Pages / Azure 둘 다 지원)
- [ ] 기존 로컬 앱을 Azure Container Apps로 마이그레이션
- [ ] 배포 히스토리/롤백
- [ ] AI 스킬로 통합 (`/deploy` 슬래시 커맨드)
