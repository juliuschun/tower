import { useEffect, useRef, useCallback, useState } from 'react';
import { toastSuccess, toastWarning, toastError } from '../utils/toast';
import { useChatStore } from '../stores/chat-store';

type MessageHandler = (data: any) => void;
type ReconnectHandler = () => void;

const STREAMING_SAFETY_TIMEOUT = 15_000; // 15 seconds

export function useWebSocket(url: string, onMessage: MessageHandler, onReconnect?: ReconnectHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(2000);
  const onMessageRef = useRef(onMessage);
  const onReconnectRef = useRef(onReconnect);
  const wasConnected = useRef(false);
  const safetyTimer = useRef<ReturnType<typeof setTimeout>>();
  const safetyTimerFired = useRef(false);
  onMessageRef.current = onMessage;
  onReconnectRef.current = onReconnect;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 2000; // Reset backoff on successful connection

      // Cancel safety timer on reconnect (keep safetyTimerFired for reconnect_result logic)
      if (safetyTimer.current) {
        clearTimeout(safetyTimer.current);
        safetyTimer.current = undefined;
      }

      if (wasConnected.current) {
        toastSuccess('재연결됨');
        onReconnectRef.current?.();
      }
      wasConnected.current = true;
      // Start ping interval
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
      ws.addEventListener('close', () => clearInterval(pingInterval), { once: true });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return;
        onMessageRef.current(data);
      } catch (err) { console.warn('[ws] onmessage parse failed:', err); }
    };

    ws.onclose = () => {
      setConnected(false);
      if (wasConnected.current) {
        toastWarning('연결 끊김, 재연결 중...');
      }

      // Start safety timer if streaming — force reset after 15s without reconnect
      const { isStreaming } = useChatStore.getState();
      if (isStreaming && !safetyTimer.current) {
        safetyTimerFired.current = false;
        safetyTimer.current = setTimeout(() => {
          safetyTimer.current = undefined;
          safetyTimerFired.current = true;
          const store = useChatStore.getState();
          if (store.isStreaming) {
            store.setStreaming(false);
            toastError('연결 끊김으로 스트리밍 중단됨');
          }
        }, STREAMING_SAFETY_TIMEOUT);
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
      reconnectTimer.current = setTimeout(connect, reconnectDelay.current);
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      clearTimeout(safetyTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, connected, ws: wsRef, safetyTimerFired };
}
