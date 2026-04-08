import React, { useState, useEffect, useRef } from 'react';
import { safeStr } from '../shared/parse-loose-json';
import type { PendingQuestion } from '../../stores/chat-store';

interface FloatingQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, answer: string) => void;
  answered?: { questionId: string; answer: string } | null;
  onDismiss?: () => void;
}

export function FloatingQuestionCard({ question, onAnswer, answered, onDismiss }: FloatingQuestionCardProps) {
  // 질문별 답변 상태 — 모두 채워야 제출
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const prevQuestionId = useRef(question.questionId);
  // "직접 입력" 모드 — 어떤 질문이 열려있는지
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});
  const [otherText, setOtherText] = useState<Record<number, string>>({});
  const otherInputRef = useRef<HTMLInputElement>(null);

  // 질문이 바뀌면 답변 초기화
  useEffect(() => {
    if (question.questionId !== prevQuestionId.current) {
      setAnswers({});
      setOtherOpen({});
      setOtherText({});
      prevQuestionId.current = question.questionId;
    }
  }, [question.questionId]);

  // Other 입력창이 열리면 자동 포커스
  useEffect(() => {
    if (Object.values(otherOpen).some(Boolean)) {
      otherInputRef.current?.focus();
    }
  }, [otherOpen]);

  const totalQuestions = question.questions.length;
  const allAnswered = Object.keys(answers).length === totalQuestions;
  const isAnswered = !!answered || allAnswered;

  const handleSelect = (qi: number, label: string) => {
    if (isAnswered || answers[qi]) return; // 이미 답한 질문은 변경 불가
    setOtherOpen(prev => ({ ...prev, [qi]: false })); // 직접 입력 닫기
    const newAnswers = { ...answers, [qi]: label };
    setAnswers(newAnswers);

    // 모든 질문에 답했을 때만 제출
    if (Object.keys(newAnswers).length === totalQuestions) {
      const combined = question.questions
        .map((q, i) => `${q.question}: ${newAnswers[i]}`)
        .join('\n');
      onAnswer(question.questionId, combined);
    }
  };

  const handleOtherSubmit = (qi: number) => {
    const text = (otherText[qi] || '').trim();
    if (!text) return;
    handleSelect(qi, text);
  };

  return (
    <div
      className="mb-3 bg-surface-800/95 backdrop-blur-sm rounded-2xl shadow-2xl border max-w-3xl mx-auto overflow-hidden transition-all duration-300"
      style={{
        borderColor: isAnswered ? 'var(--th-q-done-border)' : 'var(--th-q-pending-border)',
        animation: 'slideUp 0.3s ease-out',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{
          borderColor: isAnswered ? 'var(--th-q-done-border)' : 'var(--th-q-pending-border)',
          background: isAnswered ? 'var(--th-q-done-bg)' : 'var(--th-q-pending-bg)',
        }}
      >
        {isAnswered ? (
          <svg className="w-4 h-4" style={{ color: 'var(--th-q-done-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" style={{ color: 'var(--th-q-pending-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        <span
          className="text-[13px] font-semibold flex-1"
          style={{ color: isAnswered ? 'var(--th-q-done-heading)' : 'var(--th-q-pending-heading)' }}
        >
          {isAnswered ? 'Answered' : 'Claude is asking'}
        </span>
        {!isAnswered && onDismiss && (
          <button
            onClick={onDismiss}
            className="p-0.5 rounded hover:bg-white/10 transition-colors"
            title="Dismiss (Esc)"
          >
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {question.questions.map((q, qi) => {
          const currentAnswer = answers[qi] || (answered ? answered.answer.split('\n')[qi]?.split(': ').slice(1).join(': ') : null);
          const qAnswered = answers[qi] ?? (answered ? answered.answer.split('\n')[qi]?.split(': ').slice(1).join(': ') : null);
          const qDone = !!qAnswered;
          return (
          <div key={qi} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[14px] text-gray-200 leading-relaxed">{safeStr(q.question || q.prompt || q.title)}</div>
              {/* 이 질문만 답했고 전체 미완성일 때 — 체크 표시 */}
              {qDone && !isAnswered && (
                <svg className="w-3.5 h-3.5 shrink-0 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            {q.options && (<>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, oi) => {
                  const isSelected = currentAnswer === opt.label;
                  if (qDone) {
                    return (
                      <span
                        key={oi}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-all"
                        style={isSelected ? {
                          background: 'var(--th-q-done-selected-bg)',
                          borderColor: 'var(--th-q-done-selected-border)',
                          color: 'var(--th-q-done-selected-text)',
                        } : {
                          background: 'transparent',
                          borderColor: 'var(--th-border-subtle)',
                          color: 'var(--th-text-muted)',
                          opacity: 0.4,
                        }}
                      >
                        {isSelected && (
                          <svg className="w-3.5 h-3.5" style={{ color: 'var(--th-q-done-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {safeStr(opt.label)}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={oi}
                      onClick={() => handleSelect(qi, opt.label)}
                      className="inline-flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-lg border text-[12px] active:scale-95 transition-all cursor-pointer floating-q-btn"
                      style={{
                        background: 'var(--th-q-pending-btn-bg)',
                        borderColor: 'var(--th-q-pending-btn-border)',
                        color: 'var(--th-q-pending-btn-text)',
                      }}
                    >
                      {safeStr(opt.label)}
                      {opt.description && (
                        <span className="text-[10px]" style={{ color: 'var(--th-q-pending-desc)' }}>({safeStr(opt.description)})</span>
                      )}
                    </button>
                  );
                })}
                {/* Other (직접 입력) — 답변 완료 시 */}
                {qDone && currentAnswer && !q.options.some(o => o.label === currentAnswer) && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-all"
                    style={{
                      background: 'var(--th-q-done-selected-bg)',
                      borderColor: 'var(--th-q-done-selected-border)',
                      color: 'var(--th-q-done-selected-text)',
                    }}
                  >
                    <svg className="w-3.5 h-3.5" style={{ color: 'var(--th-q-done-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {currentAnswer}
                  </span>
                )}
                {/* Other (직접 입력) 버튼 — 미답변 시 */}
                {!qDone && !otherOpen[qi] && (
                  <button
                    onClick={() => setOtherOpen(prev => ({ ...prev, [qi]: true }))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed text-[12px] active:scale-95 transition-all cursor-pointer"
                    style={{
                      background: 'transparent',
                      borderColor: 'var(--th-q-pending-btn-border)',
                      color: 'var(--th-q-pending-desc)',
                    }}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Other...
                  </button>
                )}
              </div>
              {/* Other 텍스트 입력창 */}
              {!qDone && otherOpen[qi] && (
                <div className="flex gap-2 mt-1">
                  <input
                    ref={otherInputRef}
                    type="text"
                    value={otherText[qi] || ''}
                    onChange={e => setOtherText(prev => ({ ...prev, [qi]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleOtherSubmit(qi);
                      if (e.key === 'Escape') setOtherOpen(prev => ({ ...prev, [qi]: false }));
                    }}
                    placeholder="Type your answer..."
                    className="flex-1 px-3 py-1.5 rounded-lg border text-[12px] bg-surface-900 outline-none focus:ring-1"
                    style={{
                      borderColor: 'var(--th-q-pending-btn-border)',
                      color: 'var(--th-text-primary)',
                    }}
                  />
                  <button
                    onClick={() => handleOtherSubmit(qi)}
                    disabled={!(otherText[qi] || '').trim()}
                    className="px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all disabled:opacity-30"
                    style={{
                      background: 'var(--th-q-pending-btn-bg)',
                      borderColor: 'var(--th-q-pending-btn-border)',
                      color: 'var(--th-q-pending-btn-text)',
                    }}
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setOtherOpen(prev => ({ ...prev, [qi]: false }))}
                    className="px-2 py-1.5 rounded-lg text-[12px] transition-all hover:bg-white/5"
                    style={{ color: 'var(--th-text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>)}
          </div>
          );
        })}

        {/* Waiting spinner — 남은 질문 수 표시 */}
        {!isAnswered && (
          <div className="flex items-center gap-2 text-[11px] pt-1" style={{ color: 'var(--th-q-pending-muted)' }}>
            <div
              className="w-3 h-3 border-2 rounded-full animate-spin"
              style={{
                borderColor: 'var(--th-q-pending-spinner-track)',
                borderTopColor: 'var(--th-q-pending-spinner-head)',
              }}
            />
            {totalQuestions > 1
              ? `${Object.keys(answers).length} / ${totalQuestions} answered`
              : 'Waiting for response...'}
          </div>
        )}
      </div>
    </div>
  );
}
