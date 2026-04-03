import type { PendingQuestion } from '../stores/chat-store';

export function normalizePendingQuestion(input: {
  questionId?: string | null;
  sessionId?: string | null;
  questions?: any[] | null;
} | null | undefined): PendingQuestion | null {
  if (!input?.questionId || !input?.sessionId || !Array.isArray(input.questions)) {
    return null;
  }

  const questions = input.questions
    .filter((q) => q && typeof q.question === 'string' && q.question.trim().length > 0)
    .map((q) => ({
      question: q.question.trim(),
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: !!q.multiSelect,
      options: Array.isArray(q.options)
        ? q.options
            .filter((opt: any) => opt && typeof opt.label === 'string' && opt.label.trim().length > 0)
            .map((opt: any) => ({
              label: opt.label.trim(),
              description: typeof opt.description === 'string' ? opt.description : undefined,
            }))
        : [],
    }));

  if (questions.length === 0) {
    return null;
  }

  return {
    questionId: input.questionId,
    sessionId: input.sessionId,
    questions,
  };
}
