/**
 * messaging/router.ts — Routes messages to the right channel.
 *
 * Tries user's preferred channel first, falls back to other connected channels.
 */

import type { MessageChannel, SendOptions, SendResult } from './types.js';

export class MessageRouter {
  private channels = new Map<string, MessageChannel>();

  register(channel: MessageChannel) {
    this.channels.set(channel.provider, channel);
  }

  get(provider: string): MessageChannel | undefined {
    return this.channels.get(provider);
  }

  /** Send to a specific channel */
  async send(userId: number, provider: string, content: string, options?: SendOptions): Promise<SendResult> {
    const channel = this.channels.get(provider);
    if (!channel) return { success: false, error: `Unknown provider: ${provider}` };
    return channel.send(userId, content, options);
  }

  /** Send to the first available connected channel */
  async sendAny(userId: number, content: string, options?: SendOptions): Promise<SendResult> {
    for (const channel of this.channels.values()) {
      if (await channel.isConnected(userId)) {
        return channel.send(userId, content, options);
      }
    }
    return { success: false, error: 'No connected messaging channels' };
  }

  /** Get all connected providers for a user */
  async getConnected(userId: number): Promise<string[]> {
    const connected: string[] = [];
    for (const channel of this.channels.values()) {
      if (await channel.isConnected(userId)) {
        connected.push(channel.provider);
      }
    }
    return connected;
  }
}
