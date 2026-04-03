import { describe, it, expect, vi } from 'vitest';

describe('Pi AskUserQuestion tool', () => {
  it('exports createAskUserQuestionTool', async () => {
    const mod = await import('../pi-ask-user-tool.ts');
    expect(typeof mod.createAskUserQuestionTool).toBe('function');
  });

  it('calls askUser callback with generated questionId and raw questions', async () => {
    const { createAskUserQuestionTool } = await import('../pi-ask-user-tool.ts');
    const askUser = vi.fn(async () => 'Environment: Production');
    const tool = createAskUserQuestionTool(askUser);

    const questions = [
      {
        question: 'Environment',
        options: [
          { label: 'Production' },
          { label: 'Staging' },
        ],
      },
    ];

    const result = await tool.execute('tool-1', { questions }, undefined as any);

    expect(askUser).toHaveBeenCalledTimes(1);
    const [questionId, forwardedQuestions] = askUser.mock.calls[0];
    expect(questionId).toEqual(expect.any(String));
    expect(questionId.length).toBeGreaterThan(0);
    expect(forwardedQuestions).toEqual(questions);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Environment: Production');
  });

  it('returns error text when askUser callback rejects', async () => {
    const { createAskUserQuestionTool } = await import('../pi-ask-user-tool.ts');
    const tool = createAskUserQuestionTool(async () => {
      throw new Error('Session aborted');
    });

    const result = await tool.execute('tool-1', { questions: [{ question: 'Confirm?' }] }, undefined as any);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Session aborted');
  });
});
