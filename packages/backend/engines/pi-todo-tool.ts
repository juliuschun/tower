/**
 * TodoWrite custom tool for Pi engine.
 *
 * Mirrors Claude SDK's built-in TodoWrite tool so Pi agents can also
 * track task progress with inline checklists in the Tower UI.
 *
 * The tool itself is a no-op — it just returns "ok". The real work happens
 * on the frontend: MessageBubble detects `tool_use { name: 'TodoWrite' }`
 * and renders a TodoInlineCard with progress bar + checklist.
 */

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const TodoItemSchema = Type.Object({
  content: Type.String({ description: 'Task description in imperative form (e.g., "Run tests")' }),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
  ], { description: 'Current status of this task' }),
  activeForm: Type.String({ description: 'Present continuous form shown during execution (e.g., "Running tests")' }),
});

const TodoWriteParams = Type.Object({
  todos: Type.Array(TodoItemSchema, {
    description: 'The full updated todo list. Each call replaces the entire list.',
  }),
});

export const todoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  label: 'Todo List',
  description: 'Create and manage a structured task list to track progress on multi-step work. Use when a task has 3+ steps. Each call sends the full updated list (not a diff). The UI renders this as an interactive checklist with a progress bar.',
  promptSnippet: 'Track multi-step task progress with a visual checklist.',
  promptGuidelines: [
    'Use TodoWrite when working on tasks with 3 or more steps.',
    'Each call must include the FULL todo list (all items), not just changed ones.',
    'Keep exactly ONE task as in_progress at a time.',
    'Mark tasks completed IMMEDIATELY after finishing each one.',
    'Task content should be imperative ("Run tests"), activeForm should be continuous ("Running tests").',
    'Do NOT use for single trivial tasks or purely informational responses.',
  ],
  parameters: TodoWriteParams,

  async execute(_toolCallId: string, params: { todos: Array<{ content: string; status: string; activeForm: string }> }) {
    // No-op: the frontend renders the checklist from the tool_use input.
    // We just acknowledge receipt so the model knows it succeeded.
    const total = params.todos.length;
    const completed = params.todos.filter(t => t.status === 'completed').length;
    const inProgress = params.todos.filter(t => t.status === 'in_progress').length;
    return {
      content: [{ type: 'text' as const, text: `Todo list updated: ${completed}/${total} completed, ${inProgress} in progress.` }],
      details: undefined,
    };
  },
} as ToolDefinition;
