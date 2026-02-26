# Tower

**우리 팀의 AI 지휘본부**

AI 오케스트레이션 시스템을 쌓아 올리세요.

---

## 왜 Tower인가?

Claude Code는 미친 듯이 강력합니다. 하지만 솔직히 문제가 있습니다.

**터미널 앱입니다.** 팀의 대부분 — 기획자, 디자이너, 클라이언트, "AI로 이거 좀 도와줄 수 있어?"라고 계속 물어보는 가족들 — 은 CLI를 배우지 않을 겁니다. 절대.

**한 대의 컴퓨터에 갇혀 있습니다.** 노트북을 건네며 "여기 내 Claude 써봐"라고 할 수 없습니다. 휴대할 수 없고, 공유할 수 없습니다. 공들여 설정한 스킬, CLAUDE.md, 워크스페이스 맥락 — 전부 한 기기에 잠겨 있습니다.

**전문가가 필요합니다.** Claude Code의 진짜 힘을 끌어내려면 스킬 설정, 권한 관리, 파일 시스템, 시스템 프롬프트 작성이 필요합니다. 이걸 할 줄 아는 사람이 있어야 합니다. 없으면 능력의 20%만 쓰는 겁니다.

**그래도 공유할 수 없습니다.** 세션을 팀원과 나눌 수 없습니다. 누군가가 내가 하던 일을 이어받을 수 없습니다. 모두를 위해 Claude를 더 똑똑하게 만드는 공유 맥락을 쌓을 수 없습니다.

네, `--dangerously-skip-permissions`는 무섭습니다. 경고가 괜히 있는 게 아닙니다 — 온갖 문제가 생길 수 있습니다. 하지만 팀에게 브라우저 기반 Claude Code 접근을 줄 **방법 자체가 없는 것**? 그게 더 나쁩니다.

### Tower가 하는 일

[OpenClaw](https://github.com/anthropics/openclawai)에서 영감을 받아, Tower는 **팀 버전**입니다 — 모두가 하나의 맞춤형 AI와 협업하며 함께 키워가는 시스템.

- **브라우저 접근** — 터미널 없이 누구나 Claude를 사용
- **공유 워크스페이스** — 결정, 기억, 맥락이 세션과 사용자를 넘어 유지
- **20개 내장 스킬** — 브레인스토밍, TDD, 디버깅, 코드 리뷰, 기획 — 즉시 사용 가능
- **3계층 메모리** — Claude가 팀이 한 일, 결정한 것, 배운 것을 기억
- **역할 기반 접근** — 관리자는 전체 권한, 일반 사용자는 가드레일
- **한 번 배포, 어디서나 사용** — Cloudflare Tunnel로 HTTPS 접근

이것은 진짜 AI + 사람 협업입니다. 데모가 아닙니다. 래퍼가 아닙니다. 팀 전체가 Claude Code 위에서 함께 만들어가는 시스템입니다.

> 경고: 버그가 있습니다. 수시로 업데이트됩니다. 하지만 작동하고, 우리가 매일 쓰고 있습니다.

---

## 데모

### 브라우저에서 Claude Code와 대화

<p align="center">
  <img src="capture.gif" alt="Tower 데모 — 브라우저에서 Claude Code 사용" width="720" />
</p>

### 대시보드를 만들고 공유 — 즉석에서

<p align="center">
  <img src="capture2.gif" alt="Tower 데모 — 대시보드 생성 및 공유" width="720" />
</p>

---

## 스크린샷

<p align="center">
  <img src="docs/screenshots/login.png" alt="로그인" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/main.png" alt="메인 — 세션 + 채팅 + 파일 편집기" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/files.png" alt="파일 탐색기" width="720" />
</p>
<p align="center">
  <img src="docs/screenshots/mobile.png" alt="모바일" width="280" />
</p>

---

## 시작하기

```bash
git clone https://github.com/juliuschun/tower.git
cd tower
bash setup.sh    # 모든 것을 설치하고 몇 가지 질문을 합니다
npm run dev      # → http://localhost:32354
```

자세한 설치, 환경 변수, 프로젝트 구조, 배포 옵션은 **[INSTALL.md](INSTALL.md)**를 참고하세요.

---

## 포함된 것들

| | |
|---|---|
| **20개 AI 스킬** | 브레인스토밍, TDD, 디버깅, 코드 리뷰, 기획, UI/UX 디자인 등. [`claude-skills/README.md`](claude-skills/README.md) 참고. |
| **3계층 메모리** | 자동 메모리 + 워크스페이스 메모리 + 세션 훅. Claude가 세션을 넘어 기억합니다. [`memory-hooks/README.md`](memory-hooks/README.md) 참고. |
| **워크스페이스 템플릿** | 팀 원칙, 결정 기록, 공유 문서 — `setup.sh`로 자동 생성. |
| **파일 편집기** | 구문 하이라이팅, 실시간 파일 트리, 드래그 앤 드롭 업로드. |
| **Git 연동** | Claude 편집 시 자동 커밋, 커밋 히스토리, diff 뷰어, 롤백. |
| **관리자 패널** | 사용자 관리, 역할 기반 권한, 사용자별 워크스페이스 제한. |
| **모바일** | 반응형 레이아웃 + 하단 탭 바. PWA 지원. |

---

## 라이선스

[Apache License 2.0](LICENSE)
