import React, { useState, useEffect, useRef } from 'react';
import type { PendingQuestion } from '../../stores/chat-store';

interface FloatingQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, answer: string) => void;
  answered?: { questionId: string; answer: string } | null;
}

export function FloatingQuestionCard({ question, onAnswer, answered }: FloatingQuestionCardProps) {
  // 질문별 답변 상태 — 모두 채워야 제출
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const prevQuestionId = useRef(question.questionId);

  // 질문이 바뀌면 답변 초기화
  useEffect(() => {
    if (question.questionId !== prevQuestionId.current) {
      setAnswers({});
      prevQuestionId.current = question.questionId;
    }
  }, [question.questionId]);

  const totalQuestions = question.questions.length;
  const allAnswered = Object.keys(answers).length === totalQuestions;
  const isAnswered = !!answered || allAnswered;

  const handleSelect = (qi: number, label: string) => {
    if (isAnswered || answers[qi]) return; // 이미 답한 질문은 변경 불가
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
          className="text-[13px] font-semibold"
          style={{ color: isAnswered ? 'var(--th-q-done-heading)' : 'var(--th-q-pending-heading)' }}
        >
          {isAnswered ? 'Answered' : 'Claude is asking'}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {question.questions.map((q, qi) => {
          const qAnswered = answers[qi] ?? (answered ? answered.answer.split('\n')[qi]?.split(': ').slice(1).join(': ') : null);
          const qDone = !!qAnswered;
          return (
          <div key={qi} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[14px] text-gray-200 leading-relaxed">{q.question}</div>
              {/* 이 질문만 답했고 전체 미완성일 때 — 체크 표시 */}
              {qDone && !isAnswered && (
                <svg className="w-3.5 h-3.5 shrink-0 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            {q.options && (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, oi) => {
                  const isSelected = (answers[qi] || (answered ? answered.answer.split('\n')[qi]?.split(': ').slice(1).join(': ') : null)) === opt.label;
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
                        {opt.label}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={oi}
                      onClick={() => handleSelect(qi, opt.label)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] active:scale-95 transition-all cursor-pointer floating-q-btn"
                      style={{
                        background: 'var(--th-q-pending-btn-bg)',
                        borderColor: 'var(--th-q-pending-btn-border)',
                        color: 'var(--th-q-pending-btn-text)',
                      }}
                    >
                      {opt.label}
                      {opt.description && (
                        <span className="text-[10px]" style={{ color: 'var(--th-q-pending-desc)' }}>({opt.description})</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
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
