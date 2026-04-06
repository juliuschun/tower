---
name: deploy
description: >
  Deploy code to Cloudflare Pages (static) or Azure Container Apps (dynamic).
  Use when the user says "/deploy", "배포해줘", "이거 올려줘", "publish this",
  "사이트 배포", "앱 배포", or wants to deploy code from a project to production.
argument-hint: "<name> [source-dir]"
version: 1.0.0
---

# /deploy — 코드 배포 (Cloudflare Pages / Azure Container Apps)

프로젝트에서 만든 코드를 외부 플랫폼에 배포한다.
정적 사이트는 Cloudflare Pages CDN으로, 동적 앱은 Azure Container Apps 컨테이너로 자동 배포된다.

## 흐름

1. 소스 디렉토리 결정
2. 코드 타입 자동 감지 (static / dynamic)
3. 적합한 플랫폼에 배포
4. manifest.json에 기록
5. 결과 URL 사용자에게 안내

## 공통: JWT 토큰 생성

모든 API 호출 전에 먼저 토큰을 생성한다:

```bash
TOWER_DIR="${TOWER_DIR:-$HOME/tower}"
cd "$TOWER_DIR" && TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const env = fs.readFileSync('.env','utf-8');
let s='';
for(const l of env.split('\n')){if(l.startsWith('JWT_SECRET='))s=l.split('=').slice(1).join('=');}
console.log(jwt.sign({userId:1,username:'admin',role:'admin'},s,{expiresIn:'1h'}));
")
```

## Step 1: 소스 디렉토리 결정

인자로 받은 경로가 있으면 그대로 사용. 없으면:
- 현재 프로젝트 디렉토리에 배포할 코드가 있는지 확인
- `workspace/published/sites/<name>/` 또는 `workspace/published/apps/<name>/`에 이미 있는지 확인
- 사용자에게 확인

## Step 2: 코드 타입 감지

```bash
curl -s -X POST http://localhost:32355/api/deploy/detect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceDir\": \"$SOURCE_DIR\"}"
```

응답 예시:
```json
{"type": "static", "recommendedTarget": "cloudflare-pages"}
{"type": "dynamic", "recommendedTarget": "azure-container-apps"}
```

감지 결과를 사용자에게 알려주고, 맞는지 확인한다.

### 감지 기준

**Dynamic (→ Azure Container Apps):**
- Dockerfile 존재
- express, fastify, flask, fastapi 등 서버 프레임워크
- createServer(), .listen(port) 패턴
- package.json에 start 스크립트

**Static (→ Cloudflare Pages):**
- html, css, js, 이미지, 폰트만 있음
- 서버 코드 없음

## Step 3: 배포 실행

```bash
curl -s -X POST http://localhost:32355/api/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "APP_NAME",
    "sourceDir": "/absolute/path/to/source",
    "description": "앱 설명"
  }'
```

### 요청 파라미터

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| name | string | O | 프로젝트명 (소문자, 하이픈, 영숫자만) |
| sourceDir | string | O | 소스 절대 경로 |
| target | string | X | `cloudflare-pages` 또는 `azure-container-apps` (생략 시 자동) |
| port | number | X | 컨테이너 포트 (동적 앱, 기본 3000) |
| env | object | X | 컨테이너 환경변수 `{"KEY": "value"}` |
| description | string | X | 앱 설명 |

### 응답 예시

```json
{
  "success": true,
  "target": "cloudflare-pages",
  "url": "https://my-site.pages.dev",
  "detectedType": "static",
  "duration": 3200
}
```

## Step 4: 결과 안내

배포 성공 시:
- URL을 사용자에게 클릭 가능한 링크로 안내
- 정적이면: `https://<name>.pages.dev`
- 동적이면: Azure FQDN (예: `https://<name>.azurecontainerapps.io`)
- 소요 시간도 함께 알려줌

배포 실패 시:
- 에러 메시지 확인 후 원인 설명
- Cloudflare 토큰/Azure CLI 인증 문제가 흔함

## 기타 API

### 배포 목록 조회

```bash
curl -s http://localhost:32355/api/deploy/list \
  -H "Authorization: Bearer $TOKEN"
```

### 배포 삭제

```bash
# 정적 사이트 삭제 (CF Pages 프로젝트도 함께 삭제)
curl -s -X DELETE http://localhost:32355/api/deploy/site/SITE_NAME \
  -H "Authorization: Bearer $TOKEN"

# 동적 앱 삭제 (Azure Container App도 함께 삭제)
curl -s -X DELETE http://localhost:32355/api/deploy/app/APP_NAME \
  -H "Authorization: Bearer $TOKEN"
```

## 동적 앱에 AI 연결하기 (OpenRouter)

앱에서 LLM을 호출해야 하면 **OpenRouter**를 추천한다. 환경변수 `OPENROUTER_API_KEY`가 이미 설정되어 있다.

### 왜 OpenRouter?
- Anthropic/OpenAI/Google 등 **수백 개 모델을 하나의 API로** 사용
- OpenAI SDK 호환이라 코드 변경 최소
- 컨테이너 배포 시 API 키 하나만 넘기면 됨 (Max 구독, CLI 의존 없음)

### Python 예시 (OpenAI SDK 호환)

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1",
)

response = client.chat.completions.create(
    model="google/gemma-4-31b-it",  # 가성비 추천 모델
    messages=[{"role": "user", "content": "안녕하세요"}],
)
print(response.choices[0].message.content)
```

### Node.js 예시

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

const response = await client.chat.completions.create({
  model: 'google/gemma-4-31b-it',
  messages: [{ role: 'user', content: '안녕하세요' }],
});
```

### 배포 시 env로 전달

```bash
curl -X POST http://localhost:32355/api/deploy \
  -d '{
    "name": "my-ai-app",
    "sourceDir": "/path/to/app",
    "env": {"OPENROUTER_API_KEY": "sk-or-..."}
  }'
```

### 추천 모델 (비용 대비 성능)
- `google/gemma-4-31b-it` — 무료/저렴, 한국어 Text2SQL 등 충분
- `anthropic/claude-sonnet-4` — 복잡한 추론이 필요할 때
- `openai/gpt-4o-mini` — 빠른 응답, 가벼운 작업

## 주의사항

- `name`은 반드시 소문자 + 하이픈 + 숫자만 가능 (Cloudflare/Azure 제약)
- 동적 앱에 Dockerfile이 없으면 자동 생성됨 (Python/Node 감지)
- Azure 배포는 ACR 빌드 포함 최대 5분 소요
- Cloudflare 배포는 보통 10~30초
- 같은 이름으로 재배포하면 기존 배포를 업데이트 (덮어쓰기)
- 환경변수에 민감한 값이 필요하면 `env` 파라미터로 전달 (manifest에는 저장 안 됨)
