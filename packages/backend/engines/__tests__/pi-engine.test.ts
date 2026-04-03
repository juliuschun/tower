import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Pi engine tests — session persistence, tool registration, abort.
 *
 * These are unit/integration tests that verify Pi engine behavior
 * without requiring a running server. Uses temp directories for isolation.
 */

// ── Helpers ──

const PI_ENGINE_PATH = path.resolve(import.meta.dirname, '../pi-engine.ts');
const PI_AGENT_TOOL_PATH = path.resolve(import.meta.dirname, '../pi-agent-tool.ts');
const PI_FINANCE_TOOLS_PATH = path.resolve(import.meta.dirname, '../pi-finance-tools.ts');
const PI_FINANCE_EXTRA_PATH = path.resolve(import.meta.dirname, '../pi-finance-tools-extra.ts');
const PI_MODELS_PATH = path.resolve(import.meta.dirname, '../pi-models.json');

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

// ── Tests ──

describe('Pi engine — source contracts', () => {
  it('pi-engine.ts exists and exports PiEngine', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/export class PiEngine implements Engine/);
  });

  it('uses file-based SessionManager (not inMemory)', () => {
    const src = readSource(PI_ENGINE_PATH);
    // Should use SessionManager.create or SessionManager.open, not just inMemory
    expect(src).toMatch(/SessionManager\.create\(/);
    expect(src).toMatch(/SessionManager\.open\(/);
  });

  it('claims engineSessionId for DB persistence', () => {
    const src = readSource(PI_ENGINE_PATH);
    // claimSessionId should be called after session creation
    expect(src).toMatch(/callbacks\.claimSessionId/);
  });

  it('resumes from engineSessionId when available', () => {
    const src = readSource(PI_ENGINE_PATH);
    // Should check opts.engineSessionId and open existing session
    expect(src).toMatch(/opts\.engineSessionId/);
    expect(src).toMatch(/Resuming session/);
  });

  it('engine_done includes engineSessionId', () => {
    const src = readSource(PI_ENGINE_PATH);
    // engine_done message should include session file path
    expect(src).toMatch(/engineSessionId.*piSessionFile|piSessionFile.*engineSessionId/s);
  });

  it('abort keeps session busy until prompt promise settles', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/entry\.abortRequested\s*=\s*true/);
    expect(src).toMatch(/keep isRunning=true until the prompt promise actually settles/i);
    expect(src).toMatch(/await promptPromise/);
  });

  it('stores session files in {cwd}/.pi/sessions/', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/\.pi.*sessions/);
  });

  it('buffers turn usage until the whole prompt finishes', () => {
    const src = readSource(PI_ENGINE_PATH);
    // message_end tracks iterations but does NOT emit turn_done
    expect(src).toMatch(/iterationCount\+\+/);
    expect(src).toMatch(/cumulativeInput/);
    // turn_done is emitted only in promptPromise.then()
    expect(src).toMatch(/entry\.session\.prompt\(prompt\)[\s\S]*?type: 'turn_done'/);
  });

  it('does not emit turn_done directly from message_end', () => {
    const src = readSource(PI_ENGINE_PATH);
    const messageEndBlock = src.match(/case 'message_end':[\s\S]*?break;\n        }/);
    expect(messageEndBlock?.[0]).toBeTruthy();
    expect(messageEndBlock?.[0]).not.toContain("type: 'turn_done'");
  });

  it('G2: includes context metrics in turn_done (same contract as Claude)', () => {
    const src = readSource(PI_ENGINE_PATH);
    // turn_done must include context window tracking fields
    expect(src).toMatch(/contextInputTokens:\s*lastIterationInput/);
    expect(src).toMatch(/contextOutputTokens:\s*lastIterationOutput/);
    expect(src).toMatch(/contextWindowSize:\s*modelContextWindow/);
    expect(src).toMatch(/numIterations:\s*iterationCount/);
  });

  it('G2: tracks durationMs as wall-clock time', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/turnStartTime\s*=\s*Date\.now\(\)/);
    expect(src).toMatch(/Date\.now\(\)\s*-\s*turnStartTime/);
  });

  it('G3: yields recoverable engine_error when resume fails', () => {
    const src = readSource(PI_ENGINE_PATH);
    // createSession sets resumeFailedMessage on entry
    expect(src).toMatch(/resumeFailedMsg\s*=\s*`Previous Pi conversation/);
    // run() checks and yields it
    expect(src).toMatch(/entry\.resumeFailedMessage/);
    expect(src).toMatch(/recoverable:\s*true/);
  });

  it('G3: clears stale session ID on resume failure', () => {
    const src = readSource(PI_ENGINE_PATH);
    // Should call claimSessionId('') when resume fails
    expect(src).toMatch(/Resume failed[\s\S]*?claimSessionId\(''\)/);
  });

  it('syncs final assistant content from message_end payload', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/agentMessageToTowerBlocks/);
    expect(src).toMatch(/message_end[\s\S]*?accumulator\.replaceAll\(finalContent\)/);
    expect(src).toMatch(/message_end[\s\S]*?updateMessageContent\(msgId, finalContent\)/);
    expect(src).toMatch(/message_end[\s\S]*?type: 'assistant'[\s\S]*?content: finalContent/);
  });
});

describe('Pi engine — tool registration', () => {
  it('registers all 7 built-in tools', () => {
    const src = readSource(PI_ENGINE_PATH);
    for (const tool of ['readTool', 'bashTool', 'editTool', 'writeTool', 'grepTool', 'findTool', 'lsTool']) {
      expect(src).toContain(tool);
    }
  });

  it('registers agent custom tool', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/createAgentTool/);
  });

  it('registers AskUserQuestion custom tool', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/createAskUserQuestionTool/);
    expect(src).toMatch(/AskUserQuestion/);
  });

  it('registers finance tools (excel_read, excel_query)', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/excelReadTool/);
    expect(src).toMatch(/excelQueryTool/);
  });

  it('registers web tools (WebFetch, WebSearch)', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/webFetchTool/);
    expect(src).toMatch(/webSearchTool/);
    expect(src).toMatch(/pi-web-tools/);
  });

  it('registers extra tools (pdf_read, excel_write, excel_diff)', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/pdfReadTool/);
    expect(src).toMatch(/excelWriteTool/);
    expect(src).toMatch(/excelDiffTool/);
  });
});

describe('Pi engine — ResourceLoader context injection', () => {
  it('uses DefaultResourceLoader with appendSystemPrompt', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/DefaultResourceLoader/);
    expect(src).toMatch(/appendSystemPrompt.*towerPrompt/s);
  });

  it('loads company, personal, and project skill paths', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/getCompanySkillsDir/);
    expect(src).toMatch(/getPersonalSkillPaths/);
    expect(src).toMatch(/getProjectSkillPaths/);
  });

  it('calls buildSystemPrompt with user identity', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/buildSystemPrompt/);
    expect(src).toMatch(/opts\.userId/);
    expect(src).toMatch(/opts\.username/);
    expect(src).toMatch(/opts\.userRole/);
  });
});

describe('Pi agent tool — sub-agent', () => {
  it('pi-agent-tool.ts exports createAgentTool', () => {
    const src = readSource(PI_AGENT_TOOL_PATH);
    expect(src).toMatch(/export function createAgentTool/);
  });

  it('spawns child session with same tools', () => {
    const src = readSource(PI_AGENT_TOOL_PATH);
    expect(src).toMatch(/createAgentSession/);
    expect(src).toMatch(/readTool.*bashTool.*editTool/);
  });

  it('collects text output from child and returns it', () => {
    const src = readSource(PI_AGENT_TOOL_PATH);
    expect(src).toMatch(/resultText/);
    expect(src).toMatch(/child\.prompt/);
    expect(src).toMatch(/child\.dispose/);
  });
});

describe('Pi finance tools — excel_read', () => {
  it('supports .xlsm files', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/\.xlsm/);
    expect(src).toMatch(/keep_vba/);
  });

  it('handles Korean filename encoding via glob fallback', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/glob/);
    expect(src).toMatch(/ext_match/);
  });

  it('extracts formulas from Excel files', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/formula_map/);
    expect(src).toMatch(/data_only=False/);
  });

  it('resolves theme colors to readable names', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/theme_names/);
    expect(src).toMatch(/accent-teal|accent-blue|white-bg/);
  });

  it('extracts bold/italic formatting per row', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/fc\.font\.bold/);
    expect(src).toMatch(/fc\.font\.italic/);
  });

  it('uses runPython helper (not python3 -c for execution)', () => {
    const src = readSource(PI_FINANCE_TOOLS_PATH);
    expect(src).toMatch(/runPython\(pyScript/);
    // Should not use execSync with python3 -c for script execution (comments OK)
    expect(src).not.toMatch(/execSync\(`python3 -c/);
  });
});

describe('Pi finance tools — extra (pdf, write, diff)', () => {
  it('pdf_read handles Korean parenthetical negatives', () => {
    const src = readSource(PI_FINANCE_EXTRA_PATH);
    expect(src).toMatch(/clean_number|parenthetical/i);
  });

  it('excel_write creates formatted output with bold headers', () => {
    const src = readSource(PI_FINANCE_EXTRA_PATH);
    expect(src).toMatch(/Font.*bold/);
    expect(src).toMatch(/auto_filter|freeze_panes/);
  });

  it('excel_diff supports key_column matching', () => {
    const src = readSource(PI_FINANCE_EXTRA_PATH);
    expect(src).toMatch(/key_col/);
    expect(src).toMatch(/delta_pct|delta/);
  });

  it('uses runPython helper (not python3 -c)', () => {
    const src = readSource(PI_FINANCE_EXTRA_PATH);
    expect(src).toMatch(/runPython\(/);
    expect(src).not.toMatch(/execSync.*python3 -c/);
  });
});

describe('Pi models config', () => {
  it('pi-models.json is valid JSON', () => {
    const data = JSON.parse(fs.readFileSync(PI_MODELS_PATH, 'utf-8'));
    expect(data.models).toBeInstanceOf(Array);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it('each model has required fields', () => {
    const data = JSON.parse(fs.readFileSync(PI_MODELS_PATH, 'utf-8'));
    for (const m of data.models) {
      expect(m).toHaveProperty('provider');
      expect(m).toHaveProperty('modelId');
      expect(m).toHaveProperty('name');
      expect(m).toHaveProperty('badge');
    }
  });
});

describe('Pi session persistence — source contracts', () => {
  it('pi-engine uses SessionManager.create with .pi/sessions dir', () => {
    const src = readSource(PI_ENGINE_PATH);
    // Should create session dir and use file-based persistence
    expect(src).toMatch(/piSessionDir.*\.pi.*sessions/s);
    expect(src).toMatch(/mkdirSync.*piSessionDir/);
    expect(src).toMatch(/SessionManager\.create\(.*piSessionDir\)/);
  });

  it('uses pi-session-runtime helper for backup and recovery', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/backupPiSessionFile/);
    expect(src).toMatch(/preparePiResumeSession/);
    expect(src).toMatch(/consumeInterruptedPiSessions|gracefulPiShutdown/);
  });

  it('resume path uses SessionManager.open with engineSessionId', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/SessionManager\.open\(resumeSessionFile/);
  });

  it('claims session file path after creation', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/sessionMgr\.getSessionFile/);
    expect(src).toMatch(/callbacks\.claimSessionId\(sessionFile\)/);
  });

  it('backs up session file after creation or completion', () => {
    const src = readSource(PI_ENGINE_PATH);
    expect(src).toMatch(/backupPiSessionFile\(/);
  });

  it('ws-handler persists engineSessionId to DB on engine_done', () => {
    const wsHandlerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../routes/ws-handler.ts'), 'utf-8'
    );
    // engine_done handler should call claimClaudeSessionId
    expect(wsHandlerSrc).toMatch(/engine_done[\s\S]*?claimClaudeSessionId/);
  });

  it('ws-handler clears pending ask-user state on abort and sanitizes empty question payloads', () => {
    const wsHandlerSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../routes/ws-handler.ts'), 'utf-8'
    );
    expect(wsHandlerSrc).toMatch(/cancelPendingQuestionsForSession\(sessionId, 'Session aborted'\)/);
    expect(wsHandlerSrc).toMatch(/sanitizeAskUserQuestions/);
    expect(wsHandlerSrc).toMatch(/ask_user dropped empty payload/);
  });
});
