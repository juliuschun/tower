import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SlashCommand {
  name: string;
  description: string;
  source: 'commands' | 'skills';
}

export function loadCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [];
  const claudeDir = path.join(os.homedir(), '.claude');

  // Scan ~/.claude/commands/
  const commandsDir = path.join(claudeDir, 'commands');
  if (fs.existsSync(commandsDir)) {
    scanDirectory(commandsDir, 'commands', commands);
  }

  return commands;
}

function scanDirectory(dir: string, source: 'commands' | 'skills', commands: SlashCommand[]) {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && item.name.endsWith('.md')) {
        const name = item.name.replace('.md', '');
        const content = fs.readFileSync(path.join(dir, item.name), 'utf-8');
        const firstLine = content.split('\n')[0].trim();
        commands.push({
          name: `/${name}`,
          description: firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : firstLine.slice(0, 80),
          source,
        });
      } else if (item.isDirectory()) {
        scanDirectory(path.join(dir, item.name), source, commands);
      }
    }
  } catch {}
}
