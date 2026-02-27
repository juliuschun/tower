---
name: pinchtab
description: >
  Use when the user wants to browse a website, open a URL, take a screenshot, interact with a
  browser (click, type, scroll), or get content from pages that require JavaScript rendering.
  IMPORTANT: Always try WebFetch first for simple URL reads. Switch to pinchtab only when:
  (1) WebFetch returns empty/broken content (SPA, JS-rendered page),
  (2) the site blocks bots / returns captcha,
  (3) login session is needed (uses current Chrome session),
  (4) screenshot or visual confirmation is explicitly requested,
  (5) browser interaction (click, form fill) is needed.
  Trigger phrases: "스크린샷", "화면 캡처", "클릭해봐", "로그인해봐", "어떻게 생겼어", "브라우저로 열어".
---

# PinchTab Browser Skill

Claude Code에서 실제 Chrome 브라우저를 MCP 도구로 제어하는 스킬.
`mcp__pinchtab__*` 도구들을 활용해 실시간 웹 콘텐츠 조회, 스크린샷, DOM 조작을 수행한다.

## 우선순위 원칙

```
1순위: WebFetch          — 정적 HTML, 빠르고 저렴
2순위: PinchTab          — WebFetch 실패 시 또는 아래 케이스
```

**PinchTab으로 전환해야 하는 경우:**

| 상황 | 이유 |
|------|------|
| WebFetch 결과가 비어있거나 깨짐 | SPA/JS 렌더링 필요 |
| 봇 차단 / 캡차 응답 | 실제 브라우저로 우회 |
| 로그인이 필요한 페이지 | 현재 Chrome 세션 재사용 |
| 스크린샷 / 시각 확인 요청 | WebFetch는 이미지 불가 |
| 클릭, 폼 입력, 스크롤 등 인터랙션 | WebFetch는 읽기 전용 |

## 도구 선택

## 도구 비용 순서 (저렴 → 고가)

```
browser_text  <  browser_snapshot  <  browser_screenshot
  (~800 토큰)      (DOM 구조 텍스트)     (이미지, 가장 비쌈)
```

**기본 원칙**: 항상 `browser_text`로 시작. 시각 확인이 꼭 필요할 때만 `browser_screenshot`.

## 사용 흐름

### 1. 페이지 내용 읽기 (가장 흔한 패턴)
```
browser_navigate(url) → browser_text()
```

### 2. 시각 확인이 필요할 때
```
browser_navigate(url) → browser_screenshot()
```

### 3. 동적 페이지 / JS 렌더링
```
browser_navigate(url) → browser_snapshot()  # DOM 트리 텍스트
```

### 4. 인터랙션 (클릭/입력)
```
browser_navigate(url) → browser_snapshot()  # ref 확인
                      → browser_action({ action: "click", ref: "..." })
                      → browser_action({ action: "type", ref: "...", text: "..." })
```

### 5. JavaScript 실행
```
browser_navigate(url) → browser_evaluate({ script: "document.title" })
```

## 도구 레퍼런스

### `browser_navigate`
```json
{ "url": "https://example.com" }
```
- 반환: `{ title, url }`
- 페이지 완전 로드 대기 포함

### `browser_text`
```
(파라미터 없음)
```
- 반환: 현재 페이지의 읽기 쉬운 텍스트 (~800 토큰)
- **가장 먼저 시도할 것**

### `browser_screenshot`
```
(파라미터 없음)
```
- 반환: 현재 뷰포트 이미지 (base64)
- 시각 확인 필요할 때만 사용

### `browser_snapshot`
```
(파라미터 없음)
```
- 반환: 접근성 트리 기반 DOM 구조 (텍스트)
- `browser_action`의 `ref` 값 찾을 때 필수

### `browser_action`
```json
{ "action": "click", "ref": "<snapshot에서 얻은 ref>" }
{ "action": "type", "ref": "...", "text": "입력할 텍스트" }
{ "action": "scroll", "x": 0, "y": 500 }
{ "action": "press", "key": "Enter" }
```

### `browser_evaluate`
```json
{ "script": "return document.querySelectorAll('h1').length" }
```
- 반환: JS 실행 결과

## 실전 예시

### 뉴스 사이트 헤드라인 읽기
```
1. browser_navigate("https://www.mk.co.kr/news/")
2. browser_text()   ← 텍스트로 충분
```

### UI/레이아웃 검토
```
1. browser_navigate("https://myapp.com")
2. browser_screenshot()   ← 시각 필요
```

### 검색창에 입력하고 결과 보기
```
1. browser_navigate("https://search.naver.com")
2. browser_snapshot()           ← ref 찾기
3. browser_action(click input)
4. browser_action(type "검색어")
5. browser_action(press Enter)
6. browser_text()               ← 결과 읽기
```

### 페이지에서 특정 데이터 추출
```
1. browser_navigate(url)
2. browser_evaluate("return [...document.querySelectorAll('.price')].map(e=>e.textContent)")
```

## ⛔ 절대 금지 — 비밀번호/계정 수정

> **이 규칙은 어떤 상황에서도 예외 없이 적용된다.**

| 허용 | 금지 |
|------|------|
| 로그인 폼에 비밀번호 **입력** (browser_action type) | 비밀번호 **변경/리셋** 버튼 클릭 |
| 로그인 페이지 탐색 | "Reset password", "Change password", "Set new password" 폼 제출 |
| 현재 로그인 상태 확인 | 계정 ID/이메일 수정 |
| | 관리자 패널에서 타 유저 비밀번호 리셋 |

**구체적으로 절대 하지 말아야 할 것:**
- `/admin`, `/settings/account`, `/users/:id` 등에서 비밀번호 필드에 값 입력 후 저장
- "Reset", "Update password", "Save" 버튼 클릭 (비밀번호 변경 컨텍스트에서)
- `browser_evaluate`로 비밀번호 필드 값을 JS로 직접 설정

**이유**: 브라우저 자동화는 현재 로그인된 세션을 사용하므로, 의도치 않게 실제 계정 정보를 변경할 수 있다. 비밀번호 변경은 반드시 사용자가 직접 수행해야 한다.

---

## 주의사항

- **로그인이 필요한 페이지**: 현재 Chrome 세션의 쿠키/세션 사용 — 이미 로그인된 사이트는 바로 접근 가능
- **스크린샷 남용 금지**: 텍스트로 해결 가능하면 `browser_text` 우선
- **snapshot vs text**: 클릭/인터랙션 필요 → `snapshot` (ref 포함), 읽기만 → `text`
- **여러 페이지 탐색**: 같은 탭을 재사용 — navigate → 작업 → navigate 순서로
