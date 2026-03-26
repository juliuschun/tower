---
title: "시작하기"
icon: "🚀"
order: 1
---

# 시작하기

> Tower는 팀을 위한 AI command center입니다. AI와 대화하고, 팀원과 협업하고, 파일을 관리하고, 태스크를 자동화합니다.

---

## Tower란?

Tower는 Claude AI를 팀 단위로 사용할 수 있는 웹 플랫폼입니다. 개인 AI 대화(Session)부터 팀 채널(Channel), 파일 관리, 태스크 자동화까지 하나의 화면에서 처리합니다.

팀의 공유 AI 워크스페이스라고 생각하세요 -- 개인 생산성과 팀 협업이 만나는 곳입니다.

---

## 화면 구성

Tower는 세 영역으로 나뉩니다.

<svg viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="600" height="300" rx="8" fill="#1a1a2e" stroke="#333" stroke-width="2"/>
  <rect x="10" y="10" width="130" height="280" rx="6" fill="#16213e" stroke="#444" stroke-width="1"/>
  <text x="75" y="150" text-anchor="middle" fill="#8b8fa3" font-size="14" font-family="sans-serif">Sidebar</text>
  <rect x="150" y="10" width="280" height="280" rx="6" fill="#0f3460" stroke="#444" stroke-width="1"/>
  <text x="290" y="150" text-anchor="middle" fill="#e2e8f0" font-size="14" font-family="sans-serif">Center Panel</text>
  <rect x="440" y="10" width="150" height="280" rx="6" fill="#16213e" stroke="#444" stroke-width="1"/>
  <text x="515" y="150" text-anchor="middle" fill="#8b8fa3" font-size="14" font-family="sans-serif">Context Panel</text>
</svg>

### Sidebar (왼쪽)

Tower의 내비게이션 중심입니다. 탭으로 전환합니다.

| 탭 | 기능 |
|----|------|
| **Sessions** | AI와의 1:1 대화 목록 |
| **Channel** | 팀 채널 목록 |
| **Files** | 파일 트리 |

Sidebar 하단에는 다음 기능이 있습니다:

- **Pins** -- 즐겨찾기한 세션/파일 모아보기
- **History** -- 최근 활동 기록
- **Settings** -- 개인 설정

### Center Panel (가운데)

현재 선택한 탭에 따라 내용이 바뀝니다.

- Sessions 탭 -- 채팅 화면 (ChatPanel)
- Channel 탭 -- 채널 대화 (RoomPanel)
- Header의 Kanban 아이콘 클릭 -- 태스크 보드

### Context Panel (오른쪽)

파일을 클릭하면 나타나는 보조 패널입니다. 파일 유형에 따라 다르게 표시됩니다:

- 코드 파일 -- 구문 강조 에디터
- Markdown -- 렌더링된 프리뷰
- PDF -- PDF 뷰어
- 이미지/비디오 -- 미리보기

---

## 첫 Session 만들기

1. Sidebar에서 **Sessions** 탭을 선택합니다.
2. 상단의 **+ 버튼**을 클릭합니다.
3. 새 Session이 생성되고 입력창에 포커스됩니다.

Session은 Claude AI와의 1:1 대화 공간입니다. 주제별로 하나씩 만드는 것을 추천합니다.

---

## 첫 메시지 보내기

1. 하단 입력창에 메시지를 입력합니다.
2. **Enter**를 눌러 전송합니다.
3. AI가 실시간으로 응답을 스트리밍합니다 -- 글자가 생성되는 대로 표시됩니다.

줄바꿈이 필요하면 **Shift + Enter**를 사용하세요.

### 파일 첨부

메시지에 파일을 함께 보낼 수 있습니다.

| 방법 | 설명 |
|------|------|
| **드래그앤드롭** | 파일을 입력창 위로 드래그 |
| **클립보드 붙여넣기** | 스크린샷이나 이미지를 Ctrl+V |
| **File Tree에서 드래그** | Sidebar 파일 트리에서 파일을 입력창으로 |

첨부된 파일은 메시지와 함께 AI에게 전달됩니다. 이미지, PDF, 코드 파일 등 다양한 형식을 지원합니다.

---

## Project 개념

Project는 Tower의 핵심 정리 단위입니다. 관련된 Session, Channel, File, 태스크를 하나로 묶어줍니다.

### Project가 하는 일

- Session을 주제별/팀별로 정리
- `workspace/projects/` 아래에 전용 파일 폴더 자동 생성
- AI에게 프로젝트 맥락 제공 (AGENTS.md, CLAUDE.md)
- 팀원 초대 시 프로젝트의 모든 리소스 접근 권한 공유

### Project 만들기

1. Sidebar 상단의 프로젝트 드롭다운을 클릭합니다.
2. **+ New Project**를 선택합니다.
3. 이름을 입력하면 프로젝트가 생성됩니다.

프로젝트를 만들면 `workspace/projects/<프로젝트명>/`에 전용 폴더가 자동으로 생깁니다.

---

## 다음 단계

- AI 대화를 깊이 활용하려면 -- [Sessions](./02-sessions.md)
- 팀원과 협업하려면 -- [Channels](./03-channels.md)
- 파일을 관리하려면 -- [Files](./04-files.md)
- AI에게 작업을 맡기려면 -- [Tasks](./05-tasks.md)
- 시각화 출력을 살펴보려면 -- [Visual Blocks](./06-visual-blocks.md)
