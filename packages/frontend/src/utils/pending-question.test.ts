import { describe, it, expect } from 'vitest';
import { normalizePendingQuestion } from './pending-question';

describe('normalizePendingQuestion', () => {
  it('returns null for empty question payloads', () => {
    expect(normalizePendingQuestion({
      questionId: 'q-1',
      sessionId: 's-1',
      questions: [],
    })).toBeNull();
  });

  it('drops invalid options and keeps valid questions', () => {
    expect(normalizePendingQuestion({
      questionId: 'q-1',
      sessionId: 's-1',
      questions: [
        { question: '  배포 환경을 선택해 주세요  ', options: [{ label: ' 운영 ' }, { nope: true }] },
        { question: '   ', options: [{ label: '무시' }] },
      ],
    })).toEqual({
      questionId: 'q-1',
      sessionId: 's-1',
      questions: [
        {
          question: '배포 환경을 선택해 주세요',
          header: undefined,
          multiSelect: false,
          options: [{ label: '운영', description: undefined }],
        },
      ],
    });
  });
});
