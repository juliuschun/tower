# 스킬 시스템

## 구조

```
~/.claude/skills/
├── library/
│   ├── library.yaml       # 카탈로그 + 프로필 + 고객 레지스트리
│   └── deploy-profile.sh  # 프로필 기반 rsync 배포
├── ideate/
│   └── SKILL.md           # YAML frontmatter + body
├── gws/
│   └── SKILL.md
└── ... (49개)
```

## 스킬 로딩 메커니즘

1. **description 항상 로딩**: 매 세션 시작 시 모든 스킬의 `description` 필드가 시스템 컨텍스트에 포함
2. **트리거 판단**: Claude가 사용자 요청과 description을 매칭
3. **body 로딩**: 트리거 시 SKILL.md 전체 내용 로딩
4. **references 로딩**: 필요 시 `references/` 디렉토리 파일 Read

## 프로필 체계

| 프로필 | 태그 | 대상 |
|--------|------|------|
| standalone | core, business, docs | 고객 자체 운영 |
| managed | + browser, presentation | 우리가 운영하는 고객 VM |
| full | 전체 | Moat AI 내부 |

## 태그별 분류 (49개)

| 태그 | 수 | 주요 스킬 |
|------|-----|----------|
| core | 13 | ideate, research, search, memory, ready, best-of-n... |
| business | 9 | offer-plan, gws, text2sql, kanban, send-sms... |
| docs | 8 | mermaid-pdf, svg, agents-md, wiki-compile, claude-md... |
| dev | 9 | debug, tdd, verify, code-review, frontend-design... |
| tower-ops | 4 | fleet, deploy, tower-upgrade, library |
| internal | 4 | codex, gemini, claude-agent-sdk, design-md |
| browser | 2 | web-capture, browser-live |
| presentation | 1 | ppt-gen |
| meta | 1 | skill-architect |

## 고객 배포

```bash
# 프로필 목록
bash deploy-profile.sh --list

# 배포 미리보기
bash deploy-profile.sh --dry-run managed

# 고객 레지스트리 기반 배포
bash deploy-profile.sh --customer okusystem
```

## 스킬 description 작성 규칙

- 트리거 키워드를 자연스럽게 포함 (한/영 양쪽)
- NOT for 절로 오트리거 방지
- 3줄 이내 간결하게
- 상세 가이드: `/skill-architect` 스킬 참조
