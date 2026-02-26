# Floating Question Card Design

## 문제
AskUserQuestion UI가 ToolChip 안에 숨겨져 있어 사용자가 Claude의 질문을 놓치기 쉬움.

## 해결
채팅 하단 InputBox 바로 위에 플로팅 질문 카드를 표시.

## 결정사항
- **위치**: ChatPanel 내부, InputBox 바로 위 (같은 absolute 컨테이너)
- **ToolChip**: 기존 인라인 질문 UI 제거, 배지만 표시
- **답변 후**: 선택 결과 표시하며 스트리밍 끝날 때까지 유지
- **구현 방식**: ChatPanel 내부 absolute (방식 A)

## 컴포넌트

### FloatingQuestionCard.tsx (신규)
- Props: `question: PendingQuestion`, `onAnswer`, `answeredText?`
- 3 상태: 대기(노란), 답변완료(초록), 사라짐
- 스타일: `bg-surface-800/95 backdrop-blur-sm rounded-2xl shadow-2xl max-w-3xl mx-auto`
- 애니메이션: slide-up on mount

### ChatPanel.tsx (수정)
- `pendingQuestion` store 구독
- InputBox 컨테이너 안에서 InputBox 바로 위에 카드 렌더링
- `isStreaming` false → 카드 사라짐

### ToolUseCard.tsx (수정)
- `AskUserQuestionUI` 인라인 렌더링 제거
- AskUserQuestion ToolChip: 배지만 표시 (대기/완료 상태)

## 레이아웃
```
<div absolute bottom-X>
  {pendingQuestion && <FloatingQuestionCard />}  ← InputBox 위
  <InputBox />
</div>
```

## 데이터 흐름
1. WebSocket `ask_user` → `setPendingQuestion`
2. ChatPanel 구독 → FloatingQuestionCard 렌더
3. 사용자 클릭 → `onAnswerQuestion` → WebSocket 전송 + store clear
4. 로컬 state로 "답변 완료" 표시 유지
5. `isStreaming === false` → 카드 사라짐

## 엣지 케이스
- 다중 질문: 마지막 질문만 표시 (store 덮어쓰기)
- 세션 전환: clearMessages()가 pendingQuestion null 처리
- 타임아웃: 5분 후 ask_user_timeout → 카드 사라짐 + toast
