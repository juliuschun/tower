/**
 * messaging/types.ts — Multi-channel messaging abstraction.
 *
 * Implement MessageChannel for each provider (Kakao, Slack, Telegram).
 */

export interface SendOptions {
  title?: string;
  linkUrl?: string;
  buttonTitle?: string;
  imageUrl?: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

export interface MessageChannel {
  readonly provider: string;
  send(userId: number, content: string, options?: SendOptions): Promise<SendResult>;
  isConnected(userId: number): Promise<boolean>;
}
