# Dynamic Visual 포맷 전체 목록

Tower 채팅에서 코드블록으로 출력하면 자동 렌더링되는 18종 포맷.

## 기본 포맷 (7종)

시스템 프롬프트(`system-prompt.ts`)에서 모든 세션에 자동 주입.

| 포맷 | 코드블록 | 용도 | JSON 스키마 |
|------|---------|------|------------|
| 차트 | `chart` | 숫자 데이터 비교 | `{ "type": "bar\|line\|area\|pie\|scatter\|radar\|composed", "data": [...], "xKey", "yKey" }` |
| 다이어그램 | `mermaid` | 프로세스, 아키텍처, 관계 | Mermaid 문법 (flowchart, sequence, class, ER, gantt, state, pie, mindmap) |
| 데이터 테이블 | `datatable` | 구조화 비교, 행렬 | `{ "columns": [...], "data": [[...]] }` |
| 타임라인 | `timeline` | 로드맵, 일정 | `{ "items": [{ "date", "title", "status" }] }` |
| 수식 | `$$...$$` | LaTeX 블록 수식 | 인라인 `$` 비활성 (달러 충돌 방지) |
| HTML 샌드박스 | `html-sandbox` | 인터랙티브 데모, 프로토타입 | HTML/CSS/JS 직접 입력 (iframe sandbox) |
| 지도 | `map` | 위치, 경로, 영역 | Leaflet 기반 마커/폴리곤 |

## 확장 포맷 (11종)

시스템 프롬프트에 포함 (2026-04-14 추가).

| 포맷 | 코드블록 | 용도 | JSON 스키마 |
|------|---------|------|------------|
| 보안 입력 | `secure-input` | API 키, 토큰 입력 | `{ "target": ".env", "fields": [{ "key", "label", "required" }] }` |
| 스텝 가이드 | `steps` | 진행 상태 | `{ "steps": [{ "title", "status" }], "current": N }` |
| 코드 비교 | `diff` | Before/After | `{ "before", "after", "mode": "split" }` |
| 폼 | `form` | 사용자 입력 | `{ "fields": [{ "key", "type", "options" }] }` |
| 칸반 | `kanban` | 태스크 보드 | `{ "columns": [...], "cards": [{ "title", "column" }] }` |
| 터미널 | `terminal` | 명령 결과 | `{ "commands": [{ "cmd", "output", "status" }] }` |
| 비교 카드 | `comparison` | 옵션 비교 | `{ "items": [{ "name", "pros", "cons", "score" }] }` |
| 승인 위젯 | `approval` | 위험 작업 확인 | `{ "action", "description", "confirmLabel" }` |
| 트리맵 | `treemap` | 계층 데이터 | `{ "data": [{ "name", "value", "children" }] }` |
| 갤러리 | `gallery` | 이미지 모음 | `{ "images": [{ "src", "caption" }], "columns": N }` |
| 오디오 | `audio` | 오디오 재생 | `{ "src", "title" }` |

## 렌더링 인프라

- **파서**: `shared/split-dynamic-blocks.ts` — 코드블록 감지 + 분리
- **라우터**: `shared/RichContent.tsx` — 블록별 컴포넌트 매핑
- **컴포넌트**: `components/chat/*Block.tsx` — 개별 렌더러
- **코드 스플릿**: `React.lazy` — 미사용 포맷은 로드 안 됨
- **실시간**: 코드블록 닫히면 스트리밍 중에도 즉시 렌더
- **폴백**: JSON 파싱 실패 시 원본 코드블록 표시

## 새 포맷 추가 절차

→ `update-map.md` "시각화 포맷 추가 체크리스트" 참조

### ⚠️ 함께 수정해야 하는 위치 (drift 방지)

새 포맷을 추가하거나 기존 포맷의 필드명을 바꿀 때, 아래 위치들은 **반드시 같은 PR에서 함께** 갱신합니다. 한쪽만 고치면 AI가 새 포맷을 모르거나(프롬프트 누락) 렌더링이 실패(파서/컴포넌트 누락)합니다.

1. `packages/backend/services/system-prompt.ts` → `buildCoreSystemPrompt()`의 Visualization 섹션에 스키마 + 예시 추가
2. `packages/frontend/src/components/shared/split-dynamic-blocks.ts` → 파서에 블록 타입 감지 추가
3. `packages/frontend/src/components/shared/RichContent.tsx` → 타입 → 컴포넌트 매핑 (React.lazy)
4. `packages/frontend/src/components/chat/*Block.tsx` → 렌더러 구현
5. 이 문서(`docs/tower-guide/visual-formats.md`) → 상단 카탈로그 표 갱신

**자주 실수하는 지점**
- 시스템 프롬프트(1번)만 추가하면 AI가 출력은 하지만 렌더가 안 됨 → 원본 코드블록으로 노출.
- 렌더러(2~4번)만 추가하면 AI가 새 포맷을 알지 못해 거의 사용하지 않음.
- 필드명 변경(예: `rows` → `data`) 시 1번과 2번을 동시에 바꿔야 기존 세션 호환이 유지됨.
