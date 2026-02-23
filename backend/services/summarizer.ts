import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';

/**
 * Generate a session summary using Claude Code SDK query() with Haiku model.
 * Uses customSystemPrompt to override Claude Code's default coding assistant prompt.
 */
export async function generateSummary(messagesText: string): Promise<string> {
  const prompt = `아래부터 사용자의 대화 내역이야. 다음 형식으로 요약해줘:

1) 주제 흐름을 화살표(→)로 한 줄 표시
2) 주요 명령/작업을 불렛(•) 3~5개로 정리
3) 현재 상태를 한 줄로

예시:
모델 셀렉터 구현 → DB 마이그레이션 → 프론트 통합
• SDK Options.model로 모델 전환 기능 추가
• 세션 자동 이름 생성 서비스 구현
• SummaryCard 컴포넌트 생성
현재: 빌드 성공, 서버 테스트 중

---
${messagesText}
---

위 대화의 요약:`;

  console.log('[summarizer] prompt length:', prompt.length);
  console.log('[summarizer] prompt preview:', prompt.slice(0, 200));

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60_000);

  try {
    const response = query({
      prompt,
      options: {
        abortController,
        model: 'claude-haiku-4-5-20251001',
        executable: 'node',
        executableArgs: [],
        pathToClaudeCodeExecutable: config.claudeExecutable,
        cwd: config.defaultCwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        systemPrompt: '너는 대화 요약기다. 인사하지 마. 도구를 사용하지 마. 지시된 형식(화살표 흐름 + 불렛 포인트 + 현재 상태)으로만 출력해.',
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      },
    });

    let resultText = '';
    for await (const message of response) {
      if ((message as any).type === 'system' && (message as any).subtype === 'init') {
        console.log('[summarizer] actual model:', (message as any).model);
      }
      if ((message as any).type === 'result' && (message as any).result) {
        resultText = (message as any).result;
      } else if ((message as any).type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              resultText = block.text;
            }
          }
        }
      }
    }

    return resultText.trim() || '요약 생성 실패';
  } catch {
    return '요약 생성 실패';
  } finally {
    clearTimeout(timeout);
  }
}
