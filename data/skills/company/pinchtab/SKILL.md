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

Claude Code에서 실제 Chrome 브라우저를 CLI로 제어하는 스킬.
**MCP 서버가 아닌 on-demand 방식** — 필요할 때만 서버를 띄우고, 1시간 idle 후 자동 종료.

## ⚡ 서버 시작 (자동)

PinchTab 도구를 사용하기 전에 **반드시 서버를 시작**해야 한다.
아래 Bash 명령을 가장 먼저 실행할 것:

```bash
bash ~/.claude/scripts/pinchtab-start.sh
```

- 이미 실행 중이면 아무 일도 안 함 (idempotent)
- 1시간 idle 시 watchdog이 자동 종료
- SessionEnd hook이 세션 종료 시 정리

## CLI 사용법

MCP 도구가 아닌 **CLI 명령어**로 브라우저를 제어한다.
모든 명령은 `pinchtab` 바이너리를 직접 호출한다.

```bash
PT="$(which pinchtab)"
```

### 페이지 읽기 (가장 흔한 패턴)
```bash
$PT nav "https://example.com"    # 페이지 이동
$PT text                          # 텍스트 추출 (~800 토큰, 가장 저렴)
```

### 스크린샷
```bash
$PT ss -o /tmp/screenshot.png     # 파일로 저장
```
→ 저장 후 Read 도구로 이미지를 사용자에게 보여줄 수 있다.

### DOM 스냅샷 (인터랙션용 ref 확인)
```bash
$PT snap -i -c                    # interactive + compact (가장 효율적)
```

### 클릭 / 입력 / 키보드
```bash
$PT click e5                      # ref로 클릭
$PT type e12 "입력할 텍스트"       # ref에 텍스트 입력
$PT press Enter                   # 키 입력
$PT fill "input#search" "검색어"  # CSS 선택자로 직접 입력
```

### 스크롤 / 탭 관리
```bash
$PT scroll 500                    # 500px 아래로
$PT tabs                          # 열린 탭 목록
$PT tabs new "https://..."        # 새 탭
$PT tabs close <id>               # 탭 닫기
```

### JavaScript 실행
```bash
$PT eval "document.title"
$PT eval "[...document.querySelectorAll('.price')].map(e=>e.textContent)"
```

### PDF 저장
```bash
$PT pdf -o /tmp/page.pdf
```

### 서버 상태 확인 / 종료
```bash
$PT health                        # 서버 상태
bash ~/.claude/scripts/pinchtab-stop.sh   # 수동 종료
```

## 우선순위 원칙

```
1순위: WebFetch          — 정적 HTML, 빠르고 저렴
2순위: PinchTab CLI      — WebFetch 실패 시 또는 아래 케이스
```

**PinchTab으로 전환해야 하는 경우:**

| 상황 | 이유 |
|------|------|
| WebFetch 결과가 비어있거나 깨짐 | SPA/JS 렌더링 필요 |
| 봇 차단 / 캡차 응답 | 실제 브라우저로 우회 |
| 로그인이 필요한 페이지 | 현재 Chrome 세션 재사용 |
| 스크린샷 / 시각 확인 요청 | WebFetch는 이미지 불가 |
| 클릭, 폼 입력, 스크롤 등 인터랙션 | WebFetch는 읽기 전용 |

## 비용 순서 (저렴 → 고가)

```
text  <  snap -i -c  <  ss
```

**기본 원칙**: 항상 `text`로 시작. 시각 확인이 꼭 필요할 때만 `ss`.

## 실전 예시

### 뉴스 사이트 헤드라인 읽기
```bash
$PT nav "https://www.mk.co.kr/news/" && $PT text
```

### UI/레이아웃 검토
```bash
$PT nav "https://myapp.com" && $PT ss -o /tmp/review.png
```

### 검색창에 입력하고 결과 보기
```bash
$PT nav "https://search.naver.com"
$PT snap -i -c              # ref 찾기
$PT fill "input#query" "검색어"
$PT press Enter
sleep 2
$PT text                    # 결과 읽기
```

### 로그인이 필요한 페이지 (Facebook 등)
```bash
bash ~/.claude/scripts/pinchtab-start.sh   # 서버 시작
$PT nav "https://www.facebook.com/someone"
$PT text                                    # 로그인 세션으로 접근
```

## ⛔ 절대 금지 — 비밀번호/계정 수정

> **이 규칙은 어떤 상황에서도 예외 없이 적용된다.**

| 허용 | 금지 |
|------|------|
| 로그인 폼에 비밀번호 **입력** | 비밀번호 **변경/리셋** 버튼 클릭 |
| 로그인 페이지 탐색 | "Reset password", "Change password" 폼 제출 |
| 현재 로그인 상태 확인 | 계정 ID/이메일 수정 |
| | 관리자 패널에서 타 유저 비밀번호 리셋 |

**이유**: 브라우저 자동화는 현재 로그인된 세션을 사용하므로, 의도치 않게 실제 계정 정보를 변경할 수 있다.

## 관련 브라우저 도구

Tower에는 PinchTab 외에 두 가지 브라우저 관련 위젯이 있다:

| 위젯 | 코드블록 | 용도 |
|------|---------|------|
| **browser-popup** | ` ```browser-popup ` | 사용자에게 팝업 브라우저를 띄움 (OAuth 로그인, 외부 사이트 확인) |
| **browser-live** | ` ```browser-live ` | Neko 원격 브라우저를 채팅에 임베드 (실시간 화면 공유) |

### browser-popup 사용 예 (OAuth 로그인 등)
````
```browser-popup
{ "url": "https://accounts.google.com/...", "label": "Google Login", "description": "로그인이 필요합니다" }
```
````

### browser-live 사용 예 (실시간 브라우저 보기)
````
```browser-live
{ "description": "원격 브라우저를 확인하세요" }
```
````
→ Neko 서버가 실행 중이어야 함: `bash ~/.claude/scripts/neko-start.sh`

## 주의사항

- **로그인이 필요한 페이지**: 현재 Chrome 세션의 쿠키/세션 사용 — 이미 로그인된 사이트는 바로 접근 가능
- **스크린샷 남용 금지**: 텍스트로 해결 가능하면 `text` 우선
- **snap vs text**: 클릭/인터랙션 필요 → `snap` (ref 포함), 읽기만 → `text`
- **여러 페이지 탐색**: 같은 탭을 재사용 — nav → 작업 → nav 순서로
