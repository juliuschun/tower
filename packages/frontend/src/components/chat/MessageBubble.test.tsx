// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
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
  it('renders thinking title and tool chip in the same message', () => {
    const message: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [
        {
          type: 'thinking',
          thinking: {
            text: '**Considering signature inspection**\n\nI\'m thinking about the next step.',
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

    // Thinking chip renders the extracted title
    expect(screen.getByText('Considering signature inspection')).toBeInTheDocument();
    // Collapsed tool group renders tool type summary
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });
});
