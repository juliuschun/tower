export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: { emoji: string; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-04',
    title: 'Tower 첫 출시 🎉',
    items: [
      { emoji: '💬', text: 'AI와 1:1 대화 세션 (Sessions)' },
      { emoji: '📢', text: '팀 채널 & @ai/@task 명령어 (Channels)' },
      { emoji: '📊', text: 'Dynamic Visual — 차트·다이어그램·테이블 등 18종 렌더링' },
      { emoji: '📁', text: '파일 브라우저 & 프로젝트 관리' },
      { emoji: '🔌', text: 'Slack·Notion·Gmail·n8n MCP 연동' },
    ],
  },
];
