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
        toastSuccess('Reconnected');
        onReconnectRef.current?.();
      }
      wasConnected.current = true;
      // Start ping interval (15s for mobile stability)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
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
        toastWarning('Disconnected, reconnecting...');
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
            toastError('Streaming stopped due to disconnection');
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          // WS가 끊겼으면 즉시 재연결
          clearTimeout(reconnectTimer.current);
          connect();
        } else if (ws.readyState === WebSocket.OPEN) {
          // iOS 등에서 WS가 zombie(OPEN이지만 실제 dead) 상태일 수 있음.
          // 핑을 보내고, 짧은 시간 안에 pong이 없으면 강제 재연결.
          // 그리고 살아있더라도 세션 상태 재동기화를 위해 reconnect 핸들러 호출.
          let ponged = false;
          const zombieTimer = setTimeout(() => {
            if (!ponged && wsRef.current?.readyState === WebSocket.OPEN) {
              // pong 응답 없음 → zombie 상태, 강제 종료 후 재연결
              wsRef.current.close();
            }
          }, 3000);

          const origOnMessage = ws.onmessage;
          const pongGuard = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'pong') {
                ponged = true;
                clearTimeout(zombieTimer);
                ws.onmessage = origOnMessage;
                // 연결이 살아있음 → 세션 상태만 재동기화
                onReconnectRef.current?.();
                return;
              }
            } catch { /* ignore */ }
            origOnMessage?.call(ws, event);
          };
          ws.onmessage = pongGuard;
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
