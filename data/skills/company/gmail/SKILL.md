---
name: gmail
description: "Gmail 조회, 검색, 발송. gws CLI 기반. /gmail inbox, /gmail search 키워드, /gmail send"
---

# Gmail (gws CLI)

`gws` CLI를 사용하여 Gmail 작업을 수행합니다. MCP 도구가 아닌 Bash로 직접 실행합니다.

## 사용법

- `/gmail` — 최근 받은편지함 (5건)
- `/gmail inbox` — 받은편지함 조회
- `/gmail search 키워드` — 메일 검색
- `/gmail read 제목또는ID` — 메일 내용 읽기
- `/gmail send 수신자 제목` — 메일 작성/발송
- `/gmail draft 수신자 제목` — 임시저장 작성

## 실행

Bash 도구로 `gws` CLI 명령어를 직접 실행합니다.

### 핵심 명령어

```bash
# 메일 목록 (받은편지함)
gws gmail users messages list --params '{"userId":"me","maxResults":10,"labelIds":["INBOX"]}'

# 메일 검색
gws gmail users messages list --params '{"userId":"me","q":"검색어","maxResults":10}'

# 메일 읽기 (ID로)
gws gmail users messages get --params '{"userId":"me","id":"MESSAGE_ID"}'

# 메일 읽기 (메타데이터만)
gws gmail users messages get --params '{"userId":"me","id":"MESSAGE_ID","format":"metadata","metadataHeaders":["Subject","From","To","Date"]}'

# 메일 발송
gws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"BASE64_ENCODED_RFC2822"}'

# 임시저장
gws gmail users drafts create --params '{"userId":"me"}' --json '{"message":{"raw":"BASE64_ENCODED_RFC2822"}}'

# 라벨 목록
gws gmail users labels list --params '{"userId":"me"}'
```

### 메일 발송시 raw 메시지 생성

```bash
echo -e "From: me\nTo: recipient@example.com\nSubject: 제목\nContent-Type: text/plain; charset=utf-8\n\n본문 내용" | base64
```

### 결과 파싱 팁

- 모든 응답은 JSON
- 메일 본문은 `payload.parts[].body.data` (base64url 인코딩)
- `--format table` 옵션으로 테이블 출력 가능

## 토큰 만료 시 재인증

`gws` 명령이 401 에러를 반환하면 토큰이 만료된 것이다.
`gws auth status`로 `token_valid: false`를 확인한 후, 아래 절차로 재인증:

1. `gws auth status`로 상태 확인
2. Google OAuth URL을 생성 (client_secret.json에서 client_id 읽기)
3. `browser-popup` 코드블록으로 사용자에게 로그인 팝업 제공
4. 사용자가 로그인 후 `localhost/?code=...` 주소에서 code 복사
5. code로 토큰 교환 → `~/.config/gws/credentials.json` 저장 (type: authorized_user 필수)

```bash
# OAuth URL 생성
python3 -c "
import json, urllib.parse
with open('$HOME/.config/gws/client_secret.json') as f:
    d = json.load(f)
info = d.get('installed', d.get('web', {}))
client_id = info['client_id']
scopes = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive'
url = f'https://accounts.google.com/o/oauth2/v2/auth?client_id={urllib.parse.quote(client_id)}&redirect_uri=http%3A//localhost&response_type=code&scope={urllib.parse.quote(scopes)}&access_type=offline&prompt=consent'
print(url)
"
```

그런 다음 browser-popup으로 URL을 사용자에게 제공:
````
```browser-popup
{ "url": "<생성된 URL>", "label": "Google Login", "description": "Google 계정 재인증이 필요합니다. 로그인 후 주소창의 code= 값을 복사해주세요." }
```
````

## 주의사항

- 메일 발송 전 반드시 사용자 확인 (수신자, 제목, 본문 미리보기)
- 메일 삭제는 각별히 주의
- 첨부파일 다운로드 경로 확인
