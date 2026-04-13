# Publishing Hub 재설계 — Central Publish Gateway

**Date**: 2026-04-13
**Status**: draft
**Origin**: okusystem(고객 서버) 배포 후 Publishing Hub 에러 발견 → 근본적 재설계 논의
**Depends on**: `docs/deploy-engine.md` (기존 배포 엔진 설계)

---

## 문제

### 현상
1. **고객 서버 (okusystem)**: PublishPanel 접속 시 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` 에러
2. **내부 서버 (tower.moatai.app)**: `Hub not reachable` 에러

### 근본 원인

Publishing Hub는 **별도 Node.js 서비스**(port 32400)로 돌아간다.
Tower 본체와 독립된 프로세스이므로:

- PM2에서 시작 안 하면 죽어있어도 아무도 모름
- 고객 배포 시 Hub 설정이 누락되기 쉬움
- nginx가 `/hub/` 요청을 Hub로 프록시 → Hub 죽어있으면 nginx가 HTML 에러 반환 → JSON.parse 실패
- Hub가 Tower 인증을 서브리퀘스트로 확인 → 인증 실패해도 조용히 깨짐

### 구조적 문제

현재 아키텍처는 **각 Tower VM이 직접 Cloudflare/Azure에 배포**하는 구조.
이건 다음을 전제한다:

- 각 VM에 Cloudflare API 토큰과 Azure CLI 인증이 있어야 함
- 각 VM에 `wrangler`, `az` CLI가 설치돼야 함
- credential이 고객 VM에 분산 → 관리 어려움, 유출 위험

**Moat AI의 비즈니스 모델은 완전 managed service.** 고객은 인프라를 몰라야 한다.
현재 구조로는 이 목표를 달성할 수 없다.

---

## 설계 원칙

### 1. 코드는 하나, 역할은 .env로 결정

레포를 분리하지 않는다. Tower는 하나의 코드베이스를 유지하되,
`.env`의 `TOWER_ROLE`로 동작 모드를 결정한다.

```
TOWER_ROLE=full        # Moat AI 내부: 모든 기능 + Gateway 서버 역할
TOWER_ROLE=managed     # 고객 서버: Gateway 경유 배포 (credential 불필요)
TOWER_ROLE=standalone  # 자체 운영: 전체 설치, 자체 credential 관리
```

왜 분리하지 않는가:
- 고객 2~3개 단계에서 멀티 레포는 과한 투자
- 세션/채널/태스크/파일/스킬 — 코드의 95%는 역할과 무관하게 동일
- 분기가 필요한 곳은 publishing 로직 하나
- 나중에 고객 10+로 커지면 그때 패키지 분리해도 늦지 않음

### 2. Credential은 중앙에만

Cloudflare/Azure 키는 Moat AI 인프라(full role)에만 존재.
managed 고객 VM에는 API key 하나만 — Gateway 인증용.

### 3. Hub 프로세스 제거

별도 서비스를 없앤다. Hub가 하던 일(manifest 읽기, 상태 표시, health check)을
Tower 백엔드에 통합한다. 서비스 1개 = 관리 단순화.

### 4. 로컬 서빙이 기본

외부 CDN 배포 없이도 `okusystem.moatai.app/sites/my-report/` 같은 경로로
바로 접근 가능해야 한다. nginx가 이미 이 기능을 한다.
외부 배포(Cloudflare/Azure)는 **선택적 부가 기능**.

---

## 아키텍처

### Before (현재)

```
고객 Tower VM
├── Tower Backend (:32355)
├── Hub Server (:32400)     ← 별도 프로세스, 잘 죽음
├── nginx (프록시)
└── .env에 Cloudflare/Azure 키 필요  ← 고객에게 부담
```

### After (재설계)

```
고객 Tower VM (TOWER_ROLE=managed)
├── Tower Backend (:32355)
│   ├── /api/publish/*      ← Hub 기능 통합
│   └── publish-client.ts   ← Gateway로 파일 전송
├── nginx (프록시 + 로컬 사이트 서빙)
└── .env에 PUBLISH_API_KEY만 필요

Moat AI 서버 (TOWER_ROLE=full)
├── Tower Backend (:32355)
│   ├── /api/publish/*      ← 로컬 배포
│   └── /api/gateway/*      ← 고객 요청 수신 + 배포 실행
├── Cloudflare/Azure 키 보유
└── 배포 레지스트리 (전체 고객 사이트 현황)
```

### 배포 흐름

#### managed 모드 (고객 서버)

```
고객 UI → "Publish" 클릭
  → Tower Backend: POST /api/publish
    → publish-client.ts: sourceDir를 tar.gz 압축
    → POST gateway.moatai.app/api/gateway/publish
      headers: X-Customer-Key: cust_okusystem_xxx
      body: multipart { name, type, files.tar.gz }
  ← Gateway 응답: { url: "report.okusystem.moatai.app", status: "live" }
  → manifest.json 업데이트 (로컬 기록용)
← UI에 URL 표시
```

#### full 모드 (내부 서버)

```
내부 UI → "Publish" 클릭
  → Tower Backend: POST /api/publish
    → deploy-engine.ts: 직접 Cloudflare/Azure 배포 (기존 로직 그대로)
  ← URL 반환
  → manifest.json 업데이트
← UI에 URL 표시
```

#### standalone 모드 (자체 운영)

full과 동일하되, 고객이 자기 Cloudflare/Azure 키를 .env에 넣음.
Gateway 기능은 비활성.

---

## TOWER_ROLE별 기능 매트릭스

| 기능 | full | managed | standalone |
|------|------|---------|------------|
| AI 세션/채널/태스크 | ✅ | ✅ | ✅ |
| 파일 관리/공유 | ✅ | ✅ | ✅ |
| 스킬 | 전체 | 프로필 기반 | 전체 |
| Publishing — 로컬 서빙 (nginx) | ✅ | ✅ | ✅ |
| Publishing — 외부 배포 | 직접 (키 보유) | Gateway 경유 | 직접 (자기 키) |
| Publish Gateway API (서버 역할) | ✅ | ❌ | ❌ |
| 고객 서버 관리 | ✅ | ❌ | ❌ |
| Admin 사용자 관리 | ✅ | 제한적 | ✅ |

---

## 환경 변수

### 공통 (모든 역할)

```env
TOWER_ROLE=full|managed|standalone   # 기본: standalone
```

### managed 전용

```env
PUBLISH_GATEWAY_URL=https://tower.moatai.app/api/gateway/publish
PUBLISH_API_KEY=cust_okusystem_xxxx
```

### full 전용 (기존 변수, 이미 사용 중)

```env
CLOUDFLARE_API_TOKEN=xxx
CLOUDFLARE_ACCOUNT_ID=xxx
AZURE_RESOURCE_GROUP=tower_customers
AZURE_CONTAINER_ENV=moat-container-env
AZURE_REGISTRY=maapn8nacr.azurecr.io
AZURE_REGISTRY_NAME=maapn8nacr
```

### standalone 전용

full과 동일한 변수를 고객이 직접 설정.

---

## 구현 계획

### Phase 1: Hub 제거 + Backend 통합

**목표**: "Hub not reachable" / JSON parse 에러 해소. 서비스 2개 → 1개.

**작업**:
1. `templates/workspace/published/apps/hub/server.js` — 역할을 backend로 이전
   - manifest.json 읽기/쓰기 → backend의 deploy-engine.ts에 통합
   - health check 로직 → `/api/publish/status` 엔드포인트로 이동
   - stats/traffic → 필요시 나중에 추가 (MVP에서 제외 가능)
2. `packages/frontend/src/components/publish/PublishPanel.tsx` — API 경로 변경
   - `/hub/api/health` → `/api/publish/status`
   - `/hub/api/stats` → `/api/publish/list`
   - Hub 서버 의존성 완전 제거
3. PM2 ecosystem.config.cjs에서 hub 프로세스 제거
4. nginx에서 `/hub/` location 블록 제거 (또는 backend로 리다이렉트)
5. 고객 배포 런북 업데이트

**영향 범위**:
- Backend: routes/api.ts + services/deploy-engine.ts (엔드포인트 추가)
- Frontend: publish/PublishPanel.tsx (API 경로만 변경)
- Config: ecosystem.config.cjs, nginx
- Docs: 런북, customer-servers.md

**예상 작업량**: 1~2일

### Phase 2: TOWER_ROLE config 도입

**목표**: .env 한 줄로 서버 역할 결정.

**작업**:
1. `packages/backend/config.ts`에 `TOWER_ROLE` 파싱 추가
2. 서버 시작 시 role 로깅 (`Tower starting in [managed] mode`)
3. PublishPanel UI에서 role에 따라 다른 안내 표시
   - managed: "Moat AI를 통해 배포됩니다"
   - standalone: "직접 배포 설정을 확인하세요"
4. deploy-engine.ts에 role 분기 추가 (아직 Gateway는 없으므로, managed면 "준비 중" 표시)

**예상 작업량**: 0.5일

### Phase 3: Central Publish Gateway

**목표**: managed 고객이 버튼 하나로 외부 배포 가능.

**작업**:
1. Moat AI 서버에 `/api/gateway/publish` 엔드포인트 추가
   - API key 인증 (고객별 발급)
   - multipart file 수신
   - 기존 deploy-engine 호출 (Cloudflare/Azure)
   - 결과 URL 반환
2. `packages/backend/services/publish-client.ts` 신규 생성
   - sourceDir → tar.gz 압축
   - Gateway URL로 POST
   - 응답 URL을 manifest에 기록
3. 고객별 API key 발급/관리 (admin UI 또는 DB)
4. 배포 쿼터 관리 (고객당 사이트 수 제한 등)

**예상 작업량**: 2~3일

### Phase 4: 도메인 + 모니터링

**목표**: 고객별 서브도메인 자동 할당, 전체 사이트 모니터링.

**작업**:
1. `*.okusystem.moatai.app` 와일드카드 DNS + SSL
2. Cloudflare Pages 커스텀 도메인 자동 설정
3. Gateway에 전체 고객 사이트 대시보드
4. health check 주기 실행 + 알림

**예상 작업량**: 2~3일

---

## 기존 코드 영향 분석

### 삭제 대상

| 파일 | 이유 |
|------|------|
| `templates/workspace/published/apps/hub/server.js` | Hub 서버 전체 — backend로 흡수 |
| nginx `/hub/` location 블록 | Hub 프록시 불필요 |
| PM2 hub 프로세스 설정 | 프로세스 제거 |

### 수정 대상

| 파일 | 변경 |
|------|------|
| `packages/backend/routes/api.ts` | `/api/publish/*` 엔드포인트 추가 |
| `packages/backend/services/deploy-engine.ts` | manifest 관리 + role 분기 |
| `packages/backend/config.ts` | TOWER_ROLE 파싱 |
| `packages/frontend/src/components/publish/PublishPanel.tsx` | API 경로 변경 + role 표시 |
| `ecosystem.config.cjs` | hub 프로세스 제거 |
| `.env.example` | TOWER_ROLE, PUBLISH_GATEWAY_URL, PUBLISH_API_KEY 추가 |

### 신규 생성

| 파일 | 용도 |
|------|------|
| `packages/backend/services/publish-client.ts` | managed 모드용 Gateway 클라이언트 (Phase 3) |
| `packages/backend/routes/gateway.ts` | Gateway API 엔드포인트 (Phase 3) |

---

## 마이그레이션 전략

### 내부 서버 (tower.moatai.app)

Phase 1 완료 후 바로 적용. Hub 프로세스 종료, backend가 모든 publish 처리.

### 고객 서버 (okusystem)

1. Phase 1 코드 배포 (`git pull && ./start.sh prod-restart`)
2. Hub 프로세스 자동으로 안 뜸 (ecosystem.config에서 제거)
3. PublishPanel이 `/api/publish/status`를 호출 → 정상 동작
4. Phase 3 이후 PUBLISH_GATEWAY_URL/API_KEY 추가하면 외부 배포도 가능

### 신규 고객

배포 런북에 TOWER_ROLE=managed 설정 포함. 처음부터 깔끔.

---

## 리스크

| 리스크 | 완화책 |
|--------|--------|
| Hub에 있던 기능 누락 | Hub server.js를 줄 단위로 검토해서 필요한 것만 이전 |
| 기존 manifest.json 호환성 | 스키마 변경 없이 읽기/쓰기 위치만 이동 |
| Gateway 단일 장애점 | Phase 4에서 Azure Function 분리 가능. 초기엔 내부 서버 안정성으로 충분 |
| API key 유출 | key로 할 수 있는 건 publish뿐. 최악의 경우 사이트 배포만 됨. 즉시 폐기 가능 |

---

## 참고 문서

- 기존 배포 엔진 설계: `docs/deploy-engine.md`
- 고객 서버 레지스트리: `docs/customer-servers.md`
- 배포 런북: `docs/azure-customer-deployment-runbook.md`
- Hub 서버 코드: `templates/workspace/published/apps/hub/server.js`
- PublishPanel UI: `packages/frontend/src/components/publish/PublishPanel.tsx`
- Deploy Engine: `packages/backend/services/deploy-engine.ts`
