---
name: browser-live
description: >
  실시간 원격 브라우저를 채팅에 임베드하거나 팝업으로 띄울 때 사용.
  사용자가 서버의 브라우저 화면을 직접 보고 조작할 수 있다.
  Trigger: "브라우저 보여줘", "화면 공유", "실시간 브라우저", "Neko", "원격 브라우저",
  "browser-live", "브라우저 띄워", "같이 보자"
---

# Browser Live — 실시간 원격 브라우저

서버에서 실행 중인 실제 Chromium 브라우저를 사용자에게 실시간으로 보여주는 스킬.
WebRTC 기반 Neko 컨테이너를 사용하며, 사용자는 마우스/키보드로 직접 조작할 수 있다.

## 언제 사용하나?

| 상황 | 이 스킬 사용 |
|------|-------------|
| 사용자가 브라우저 화면을 직접 봐야 할 때 | ✅ |
| OAuth 로그인 등 사용자 조작이 필요할 때 | ✅ (또는 browser-popup) |
| AI가 PinchTab으로 작업하는 걸 보여줄 때 | ✅ |
| 스크린샷 한 장이면 충분할 때 | ❌ → PinchTab `ss` 사용 |
| 텍스트 추출만 필요할 때 | ❌ → PinchTab `text` 또는 WebFetch |

## 서버 시작

```bash
bash ~/.claude/scripts/neko-start.sh
```

- Docker 컨테이너 `neko-browser`를 시작 (이미 실행 중이면 스킵)
- 포트: 32800 (WebRTC UI)
- 60분 idle 후 자동 종료
- 비밀번호: `tower`

## 서버 종료

```bash
bash ~/.claude/scripts/neko-stop.sh
```

## 채팅에 임베드

채팅 메시지에 `browser-live` 코드블록을 출력하면 자동으로 iframe이 렌더링된다:

````
```browser-live
{ "description": "원격 브라우저를 확인하세요" }
```
````

### JSON 스펙

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `path` | string | `/neko/` | Neko URL 경로 |
| `height` | number | `560` | iframe 높이 (px) |
| `description` | string | | 설명 텍스트 |

### 확장/축소 버튼
- 위젯 헤더에 확장 버튼 → 720px로 확대
- 새 탭 열기 버튼 → `/neko/`를 별도 탭으로

## 팝업으로 열기

임베드 대신 별도 창으로 열고 싶으면 `browser-popup` 사용:

````
```browser-popup
{ "url": "/neko/", "label": "원격 브라우저 열기", "description": "Neko 브라우저를 새 창으로 엽니다", "width": 1300, "height": 800 }
```
````

## 브라우저 도구 패밀리

Tower에는 3가지 브라우저 도구가 있다:

| 도구 | 코드블록 | 주체 | 용도 |
|------|---------|------|------|
| **PinchTab** | (Bash CLI) | AI가 조작 | 자동화, 스크래핑, 스크린샷 |
| **browser-popup** | ` ```browser-popup ` | 사용자가 조작 | OAuth 로그인, 외부 사이트 팝업 |
| **browser-live** | ` ```browser-live ` | 사용자가 조작 | 실시간 화면 공유, 임베드 |

## 주의사항

- Neko 서버가 실행 중이어야 위젯이 동작한다. 서버 미실행 시 먼저 `neko-start.sh` 실행.
- 같은 Neko 세션을 여러 사용자가 동시에 볼 수 있다 (멀티뷰어).
- 오디오도 지원된다 (WebRTC).
