import crypto from 'crypto';
import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { EngineCallbacks } from './types.js';

const AskUserQuestionParams = Type.Object({
  questions: Type.Array(Type.Any(), {
    description: 'Questions to present to the user. Keep the raw structure so ws-handler can forward it as-is.',
  }),
});

export function createAskUserQuestionTool(
  askUser: EngineCallbacks['askUser'],
): ToolDefinition {
  return {
    name: 'AskUserQuestion',
    label: 'Ask User Question',
    description: 'Pause execution to ask the user a question and wait for their answer.',
    promptSnippet: 'Ask the user a question when a decision requires explicit confirmation or missing information.',
    promptGuidelines: [
      'Use AskUserQuestion when you need explicit user input to continue safely.',
      'Pass the raw questions array so the frontend can render the existing question UI.',
      'Prefer this tool over guessing when environment, deployment target, or destructive actions are ambiguous.',
    ],
    parameters: AskUserQuestionParams,

    async execute(_toolCallId: string, params: { questions: any[] }) {
      try {
        const questionId = `q-${crypto.randomUUID()}`;
        const answer = await askUser(questionId, params.questions || []);
        return {
          content: [{ type: 'text' as const, text: answer || '(no answer provided)' }],
          details: undefined,
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `AskUserQuestion error: ${err?.message || 'Unknown error'}` }],
          details: undefined,
        };
      }
    },
  } as ToolDefinition;
}
