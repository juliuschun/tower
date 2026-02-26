---
name: gdrive
description: "Google Drive 공유 드라이브 조회/다운로드/업로드. /gdrive list, /gdrive search, /gdrive pull, /gdrive push"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# Google Drive 공유 드라이브 관리

rclone 기반 Google Drive 공유 드라이브 동기화 스킬.

## 환경

- rclone remote: `gdrive:`
- 로컬 경로: `~/workspace/google-drive/`
- 메타데이터: 각 드라이브 폴더의 `.file-index.json`
- 드라이브 목록: `~/workspace/google-drive/drives-index.json`

## 사용법

### `/gdrive list`
공유 드라이브 목록 표시. drives-index.json에서 읽어서 표 형태로 보여줌.

### `/gdrive search <키워드>`
모든 공유 드라이브의 .file-index.json에서 파일명 검색.
```bash
grep -rl "키워드" ~/workspace/google-drive/*/.file-index.json
```
그 후 매칭된 파일의 Path를 보여줌.

### `/gdrive pull <드라이브이름> [경로]`
특정 공유 드라이브 또는 그 안의 특정 폴더/파일을 로컬에 다운로드.

1. drives-index.json에서 드라이브 ID 조회
2. rclone copy 실행:
```bash
rclone copy gdrive: ~/workspace/google-drive/<드라이브이름>/<경로> \
  --drive-team-drive <드라이브ID> \
  --filter "+ <경로>/**" --filter "- **"
```
경로 미지정 시 전체 다운로드 (용량 확인 후 진행).

### `/gdrive push <드라이브이름> <로컬경로>`
로컬 파일을 공유 드라이브에 업로드.

1. drives-index.json에서 드라이브 ID 조회
2. rclone copy 실행:
```bash
rclone copy <로컬경로> gdrive:<원격경로> \
  --drive-team-drive <드라이브ID>
```

### `/gdrive sync <드라이브이름>`
양방향은 위험하므로, 단방향 동기화 (Drive → 로컬).
```bash
rclone sync gdrive: ~/workspace/google-drive/<드라이브이름>/ \
  --drive-team-drive <드라이브ID>
```
**주의**: 로컬에만 있는 파일은 삭제됨. 반드시 확인 후 실행.

### `/gdrive refresh`
모든 공유 드라이브의 .file-index.json 메타데이터를 최신으로 갱신.
```bash
rclone lsjson gdrive: --drive-team-drive <ID> -R --no-modtime --fast-list
```

## 실행 규칙

1. **용량 확인 필수**: pull/sync 전에 .file-index.json에서 대상 크기 계산. 1GB 초과 시 사용자에게 확인.
2. **디스크 여유 확인**: `df -h /` 로 남은 공간 확인 후 진행.
3. **Google Docs 변환**: rclone은 Google Docs/Sheets/Slides를 자동으로 docx/xlsx/pptx로 변환. 크기가 0 또는 -1인 파일은 Google 문서.
4. **rate limit**: 403 에러 시 10초 대기 후 재시도.
5. **출력 형태**: 결과는 한국어로, 표 형태로 간결하게.
