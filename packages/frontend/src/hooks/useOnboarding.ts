import { useEffect, useRef, useState } from 'react';
import { type SessionMeta } from '../stores/session-store';
import { CHANGELOG } from '../data/changelog';

const CURRENT_VERSION = CHANGELOG[0].version;

function welcomedKey(userId: string) {
  return `tower:welcomed:${userId}`;
}
function lastVersionKey(userId: string) {
  return `tower:lastSeenVersion:${userId}`;
}

interface UseOnboardingOptions {
  token: string | null;
  userId: string | null;
  sessions: SessionMeta[];
  sessionsLoaded: boolean;
  createSession: (name: string) => Promise<SessionMeta | null>;
  sendMessage: (message: string) => void;
  selectSession: (session: SessionMeta) => void;
}

interface OnboardingState {
  showWhatsNew: boolean;
  dismissWhatsNew: () => void;
}

export function useOnboarding({
  token,
  userId,
  sessions,
  sessionsLoaded,
  createSession,
  sendMessage,
  selectSession,
}: UseOnboardingOptions): OnboardingState {
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const welcomeTriggeredRef = useRef(false);

  // 1. What's New: 버전 변경 감지 (온보딩 완료된 기존 사용자만)
  useEffect(() => {
    if (!userId || !token || !sessionsLoaded) return;

    const welcomed = localStorage.getItem(welcomedKey(userId));
    const lastVersion = localStorage.getItem(lastVersionKey(userId));

    if (welcomed === 'true' && lastVersion !== CURRENT_VERSION) {
      setShowWhatsNew(true);
    }
  }, [userId, token, sessionsLoaded]);

  // 2. Welcome Bot: 세션이 0개인 신규 사용자
  useEffect(() => {
    if (!userId || !token || !sessionsLoaded) return;
    if (welcomeTriggeredRef.current) return;

    if (sessions.length > 0) {
      // 기존 사용자: welcomed 마크 보장
      if (localStorage.getItem(welcomedKey(userId)) !== 'true') {
        localStorage.setItem(welcomedKey(userId), 'true');
        localStorage.setItem(lastVersionKey(userId), CURRENT_VERSION);
      }
      return;
    }

    // 신규 사용자 (세션 0개)
    const welcomed = localStorage.getItem(welcomedKey(userId));
    if (welcomed === 'true') return;

    welcomeTriggeredRef.current = true;

    void (async () => {
      const session = await createSession('👋 Tower 시작 가이드');
      if (!session) return;

      selectSession(session);

      // 세션 활성화 대기 후 트리거 메시지 전송
      await new Promise<void>((r) => setTimeout(r, 800));

      sendMessage(
        'Tower에 처음 오신 것을 환영합니다! 🎉\n\n' +
        'Tower의 주요 기능들을 Dynamic Visual(차트, 다이어그램, 데이터 테이블, 타임라인 등)을 ' +
        '풍부하게 활용해서 소개해주세요. 아래 항목들을 포함해주세요:\n\n' +
        '1. **Sessions** — AI와 1:1 대화하는 공간\n' +
        '2. **Channels** — 팀 채팅 + @ai(빠른 답변) / @task(풀 작업) 사용법\n' +
        '3. **Dynamic Visual** — 실제 차트 예시 1개와 다이어그램 예시 1개를 보여주면서 설명\n' +
        '4. **Files & Projects** — 파일 브라우저와 프로젝트 구조\n' +
        '5. **유용한 Tips** — 효율적인 사용을 위한 팁 3가지\n\n' +
        '각 항목을 시각적으로 풍부하게 만들어주세요!'
      );

      localStorage.setItem(welcomedKey(userId), 'true');
      localStorage.setItem(lastVersionKey(userId), CURRENT_VERSION);
    })();
  }, [userId, token, sessions, sessionsLoaded, createSession, sendMessage, selectSession]);

  const dismissWhatsNew = () => {
    setShowWhatsNew(false);
    if (userId) {
      localStorage.setItem(lastVersionKey(userId), CURRENT_VERSION);
    }
  };

  return { showWhatsNew, dismissWhatsNew };
}
