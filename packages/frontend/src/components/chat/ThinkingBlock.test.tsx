// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThinkingChip } from './ThinkingBlock';
import { useChatStore } from '../../stores/chat-store';

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

describe('ThinkingChip', () => {
  it('shows extracted thinking title instead of the generic thinking label', () => {
    render(
      <ThinkingChip
        text={'**Considering signature inspection**\n\nI’m thinking about the next step.'}
        isActive={false}
        onClick={() => {}}
      />
    );

    expect(screen.getByText('Considering signature inspection')).toBeInTheDocument();
    expect(screen.queryByText(/^thinking$/i)).not.toBeInTheDocument();
  });
});
