import { query, queryOne, execute } from '../db/pg-repo.js';
import { extractTextFromContent } from '../utils/text.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BLOB_DIR = path.join(process.cwd(), 'data', 'blobs');

// Threshold above which base64 binary content is extracted to disk
const BLOB_THRESHOLD = 8 * 1024; // 8 KB of base64 text

export interface StoredMessage {
  id: string;
  session_id: string;
  role: string;
  content: string; // JSON string of ContentBlock[]
  parent_tool_use_id?: string | null;
  created_at?: string;
  duration_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

/**
 * Strip bloat from content blocks before saving to DB:
 * 1. Remove `thinking` blocks (not needed for display or resume)
 * 2. Extract large base64 images/PDFs to disk, replace with file reference
 * 3. Truncate large tool_result text (keep first/last 2KB)
 */
function compactContent(blocks: any[]): any[] {
  if (!Array.isArray(blocks)) return blocks;

  const result: any[] = [];
  for (const block of blocks) {
    // 1. Strip thinking blocks entirely
    if (block.type === 'thinking') continue;

    // 2. Extract base64 sources (images, PDFs) to disk
    if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
      const data = block.source.data as string;
      if (data.length > BLOB_THRESHOLD) {
        const blobRef = extractBlobToDisk(data, block.source.media_type || 'image/png');
        if (blobRef) {
          result.push({ ...block, source: { type: 'blob_ref', path: blobRef, media_type: block.source.media_type } });
          continue;
        }
      }
    }

    // 2b. Base64 in document blocks (PDFs)
    if (block.type === 'document' && block.source?.type === 'base64' && block.source.data) {
      const data = block.source.data as string;
      if (data.length > BLOB_THRESHOLD) {
        const blobRef = extractBlobToDisk(data, block.source.media_type || 'application/pdf');
        if (blobRef) {
          result.push({ ...block, source: { type: 'blob_ref', path: blobRef, media_type: block.source.media_type } });
          continue;
        }
      }
    }

    // 2c. Base64 images inside tool_result content arrays
    if (block.type === 'tool_result' && Array.isArray(block.content)) {
      const compactedInner = block.content.map((inner: any) => {
        if (inner.type === 'image' && inner.source?.type === 'base64' && inner.source.data?.length > BLOB_THRESHOLD) {
          const blobRef = extractBlobToDisk(inner.source.data, inner.source.media_type || 'image/png');
          if (blobRef) {
            return { ...inner, source: { type: 'blob_ref', path: blobRef, media_type: inner.source.media_type } };
          }
        }
        return inner;
      });
      result.push({ ...block, content: compactedInner });
      continue;
    }

    // 3. Truncate very large text blocks in tool results (>8KB)
    if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > BLOB_THRESHOLD) {
      const text = block.content;
      const truncated = text.slice(0, 2048) + `\n\n... [truncated ${(text.length / 1024).toFixed(0)}KB → 4KB] ...\n\n` + text.slice(-2048);
      result.push({ ...block, content: truncated });
      continue;
    }

    result.push(block);
  }
  return result;
}

function extractBlobToDisk(base64Data: string, mediaType: string): string | null {
  try {
    if (!fs.existsSync(BLOB_DIR)) {
      fs.mkdirSync(BLOB_DIR, { recursive: true });
    }
    const hash = crypto.createHash('sha256').update(base64Data.slice(0, 1024) + base64Data.length).digest('hex').slice(0, 16);
    const ext = mediaType.includes('pdf') ? '.pdf' : mediaType.includes('png') ? '.png' : '.jpg';
    const filename = `${hash}${ext}`;
    const filePath = path.join(BLOB_DIR, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    }
    return filename; // relative to BLOB_DIR
  } catch (err) {
    console.error('[msg-store] blob extraction failed:', err);
    return null;
  }
}

export async function saveMessage(
  sessionId: string,
  msg: { id: string; role: string; content: any; parentToolUseId?: string | null }
): Promise<void> {
  // Compact content before serializing
  const content = Array.isArray(msg.content) ? compactContent(msg.content) : msg.content;
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  await execute(
    `INSERT INTO messages (id, session_id, role, content, parent_tool_use_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET content = EXCLUDED.content, parent_tool_use_id = EXCLUDED.parent_tool_use_id, duration_ms = EXCLUDED.duration_ms, input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens`,
    [msg.id, sessionId, msg.role, contentStr, msg.parentToolUseId || null]
  );
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  return await query(
    `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  ) as StoredMessage[];
}

export async function updateMessageContent(messageId: string, content: any): Promise<void> {
  const compacted = Array.isArray(content) ? compactContent(content) : content;
  const contentStr = typeof compacted === 'string' ? compacted : JSON.stringify(compacted);
  await execute(`UPDATE messages SET content = $1 WHERE id = $2`, [contentStr, messageId]);
}

/** Attach a tool result to the matching tool_use block in DB */
export async function attachToolResultInDb(sessionId: string, toolUseId: string, result: string): Promise<void> {
  // Find assistant messages in this session that contain this tool_use_id
  const rows = await query(
    `SELECT id, content FROM messages WHERE session_id = $1 AND role = 'assistant' ORDER BY created_at DESC`,
    [sessionId]
  ) as { id: string; content: string }[];

  for (const row of rows) {
    try {
      const content = JSON.parse(row.content);
      let found = false;
      for (const block of content) {
        if (block.type === 'tool_use' && (block.id === toolUseId || block.toolUse?.id === toolUseId)) {
          if (block.toolUse) {
            block.toolUse.result = result;
          } else {
            block.result = result;
          }
          found = true;
          break;
        }
      }
      if (found) {
        await execute(`UPDATE messages SET content = $1 WHERE id = $2`, [JSON.stringify(content), row.id]);
        return;
      }
    } catch {}
  }
}

export async function updateMessageMetrics(
  messageId: string,
  metrics: { duration_ms?: number; input_tokens?: number; output_tokens?: number }
): Promise<void> {
  await execute(
    `UPDATE messages SET duration_ms = $1, input_tokens = $2, output_tokens = $3 WHERE id = $4`,
    [metrics.duration_ms ?? null, metrics.input_tokens ?? null, metrics.output_tokens ?? null, messageId]
  );
}

export async function deleteMessages(sessionId: string): Promise<void> {
  await execute(`DELETE FROM messages WHERE session_id = $1`, [sessionId]);
}
