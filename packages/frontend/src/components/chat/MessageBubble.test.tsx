// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useChatStore, type ChatMessage } from '../../stores/chat-store';

beforeEach(() => {
  useChatStore.setState({
    isStreaming: false,
    sessionId: null,
    claudeSessionId: null,
    messages: [],
    slashCommands: [],
    attachments: [],
    messageQueue: {},
  });
});

describe('MessageBubble thinking/tool meta row', () => {
  it('renders thinking title and tool chip in the same meta row', () => {
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [
        {
          type: 'thinking',
          thinking: {
            text: '**Considering signature inspection**\n\nI’m thinking about the next step.',
          },
        },
        {
          type: 'tool_use',
          toolUse: {
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'ls -la' },
          },
        },
      ],
    };

    render(<MessageBubble message={message} />);

    const metaRow = screen.getByTestId('assistant-meta-row');
    expect(within(metaRow).getByText('Considering signature inspection')).toBeInTheDocument();
    expect(within(metaRow).getByText('$ ls -la')).toBeInTheDocument();
  });
});
