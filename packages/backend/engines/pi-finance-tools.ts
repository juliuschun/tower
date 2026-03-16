/**
 * Finance-oriented custom tools for Pi engine.
 *
 * Tools:
 *   - excel_read: Smart read with merged-cell unmerging, auto header detection,
 *                 formatting extraction (bold/italic/color), and formula capture
 *   - excel_query: Run pandas operations on a pre-cleaned spreadsheet
 *
 * Korean Excel files often have merged cells, multi-row headers, decorative
 * formatting, color-coded semantics, and formulas that encode business logic.
 * These tools handle all of that automatically.
 */

import { Type } from '@sinclair/typebox';
import { execSync } from 'child_process';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

// ── Shared Python helper: smart Excel reader with full metadata ──
const SMART_READER_PY = String.raw`
import openpyxl, pandas as pd, json, sys, os
from collections import Counter

def _rgb_str(color):
    if not color: return None
    try:
        if color.type == 'rgb' and color.rgb and str(color.rgb) != '00000000':
            return str(color.rgb)[-6:]
        if color.type == 'theme':
            return f"theme:{color.theme}"
    except: pass
    return None

def smart_read(path, sheet_name=None, max_rows=100):
    """Read Excel with merged-cell unmerging, auto header detection,
    formatting extraction, and formula capture."""
    import glob as _glob

    # Resolve path: if file not found, try glob (handles broken-encoding Korean filenames)
    if not os.path.exists(path):
        # Try glob in the same directory
        parent = os.path.dirname(path) or '.'
        candidates = _glob.glob(os.path.join(parent, '*'))
        # Match by basename similarity or extension
        base = os.path.basename(path).lower()
        ext_match = [f for f in candidates if os.path.splitext(f)[1].lower() in ('.xlsx','.xls','.xlsm','.csv')]
        if len(ext_match) == 1:
            path = ext_match[0]
        elif ext_match:
            # Try partial name match
            for f in ext_match:
                if base[:4] in os.path.basename(f).lower():
                    path = f; break
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")

    ext = os.path.splitext(path)[1].lower()

    if ext == '.csv':
        df = pd.read_csv(path)
        return df, {
            "file": os.path.basename(path),
            "shape": list(df.shape),
            "merged_fixed": 0, "header_row": 0,
        }

    # Load twice: values + formulas (.xlsm needs keep_vba=False to skip macros)
    kw = {"keep_vba": False} if ext == '.xlsm' else {}
    wb_val = openpyxl.load_workbook(path, data_only=True, **kw)
    wb_fmt = openpyxl.load_workbook(path, data_only=False, **kw)
    ws_val = wb_val[sheet_name] if sheet_name and sheet_name in wb_val.sheetnames else wb_val.active
    ws_fmt = wb_fmt[sheet_name] if sheet_name and sheet_name in wb_fmt.sheetnames else wb_fmt.active

    # 1. Unmerge in both workbooks
    merged_ranges = list(ws_val.merged_cells.ranges)
    for wb_ws in [(wb_val, ws_val), (wb_fmt, ws_fmt)]:
        ws = wb_ws[1]
        for mr in list(ws.merged_cells.ranges):
            val = ws.cell(mr.min_row, mr.min_col).value
            ws.unmerge_cells(str(mr))
            for r in range(mr.min_row, mr.max_row + 1):
                for c in range(mr.min_col, mr.max_col + 1):
                    ws.cell(r, c, val)

    # 2. Extract rows: values from ws_val, formatting + formulas from ws_fmt
    data = []
    cell_styles = []  # per-row list of per-cell style strings
    bg_counter = Counter()
    formulas = {}  # {col_name: formula_pattern}

    max_col = ws_val.max_column or 20
    for row_idx, (val_row, fmt_row) in enumerate(
        zip(ws_val.iter_rows(values_only=False, max_col=max_col),
            ws_fmt.iter_rows(values_only=False, max_col=max_col))):
        vals = [c.value for c in val_row]
        data.append(vals)

        row_style_parts = []
        for ci, (vc, fc) in enumerate(zip(val_row, fmt_row)):
            parts = []
            if fc.font.bold and vc.value is not None: parts.append("B")
            if fc.font.italic and vc.value is not None: parts.append("I")
            bg = _rgb_str(fc.fill.fgColor)
            if bg:
                parts.append(f"bg:#{bg}")
                if vc.value is not None: bg_counter[bg] += 1
            # Capture formula
            fv = fc.value
            if isinstance(fv, str) and fv.startswith("="):
                parts.append(f"f:{fv}")
            row_style_parts.append(" ".join(parts) if parts else "")
        cell_styles.append(row_style_parts)

    if not data:
        return pd.DataFrame(), {"error": "Empty sheet"}

    # 3. Auto-detect header row
    header_idx = 0
    for i, row in enumerate(data[:10]):
        total = len(row)
        non_empty = sum(1 for v in row if v is not None and str(v).strip())
        str_cells = sum(1 for v in row if isinstance(v, str) and v.strip())
        if total > 0 and non_empty > total * 0.3 and str_cells > non_empty * 0.4:
            header_idx = i
            break

    # 4. Build column names
    raw_headers = data[header_idx]
    headers = []; seen = {}
    for i, v in enumerate(raw_headers):
        name = str(v).strip() if v else f"col_{i}"
        if not name: name = f"col_{i}"
        if name in seen: seen[name] += 1; name = f"{name}_{seen[name]}"
        else: seen[name] = 0
        headers.append(name)

    # 5. Build DataFrame
    rows = data[header_idx + 1:]
    styles_rows = cell_styles[header_idx + 1:]
    df = pd.DataFrame(rows, columns=headers)
    df = df.dropna(how='all').dropna(axis=1, how='all')
    drop_cols = [c for c in df.columns if c.startswith('col_') and df[c].isna().all()]
    df = df.drop(columns=drop_cols, errors='ignore')

    # 6. Build _style column: per-row summary
    remaining_cols = list(df.columns)
    col_indices = {h: i for i, h in enumerate(headers) if h in remaining_cols}
    style_col = []
    for idx in df.index:
        if idx < len(styles_rows):
            sr = styles_rows[idx]
            # Collect unique styles from cells in this row
            parts = set()
            for ci, s in enumerate(sr):
                if not s: continue
                for p in s.split():
                    if p.startswith("f:"): continue  # formulas go to separate column
                    parts.add(p)
            style_col.append(" ".join(sorted(parts)) if parts else "")
        else:
            style_col.append("")
    if any(style_col):
        df["_style"] = style_col

    # 7. Detect formula patterns per column
    formula_map = {}  # col_name -> representative formula
    for idx in df.index:
        if idx >= len(styles_rows): continue
        sr = styles_rows[idx]
        for ci, s in enumerate(sr):
            if not s or "f:" not in s: continue
            for part in s.split():
                if part.startswith("f:"):
                    col_name = headers[ci] if ci < len(headers) else f"col_{ci}"
                    if col_name in remaining_cols and col_name not in formula_map:
                        formula_map[col_name] = part[2:]
        if len(formula_map) >= 20: break  # enough samples

    # 8. Color legend
    known = {
        "FFFF00": "highlight/active", "FFC000": "warning/estimate",
        "FF0000": "negative/alert", "00FF00": "positive/confirmed",
        "D8D8D8": "header", "D9D9D9": "header/summary",
        "EFEFEF": "subtotal", "B0B0B0": "section-label",
        "E2EFDA": "positive", "FCE4D6": "caution",
    }
    color_legend = {}
    for color, count in bg_counter.most_common(10):
        label = known.get(color, "custom")
        color_legend[f"#{color}"] = f"{label} ({count} cells)"

    # 9. Number formats
    num_fmts = Counter()
    for row in ws_fmt.iter_rows(max_row=50, max_col=20):
        for c in row:
            if c.value is not None and c.number_format != 'General':
                num_fmts[c.number_format] += 1

    meta = {
        "file": os.path.basename(path),
        "sheet": ws_val.title,
        "sheets": wb_val.sheetnames,
        "shape": list(df.shape),
        "merged_fixed": len(merged_ranges),
        "header_row": header_idx,
        "color_legend": color_legend,
        "number_formats": dict(num_fmts.most_common(5)),
        "formulas": formula_map,
    }
    return df.head(max_rows), meta
`;

function ensureReaderScript(): void {
  const tmpPath = '/tmp/tower_excel_reader.py';
  try {
    require('fs').writeFileSync(tmpPath, SMART_READER_PY, 'utf-8');
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════
// excel_read — Smart read with full metadata
// ═══════════════════════════════════════════════════════════════

const ExcelReadParams = Type.Object({
  path: Type.String({ description: 'Path to the Excel (.xlsx, .xls, .xlsm) or CSV file' }),
  sheet: Type.Optional(Type.String({ description: 'Sheet name. Defaults to first sheet.' })),
  rows: Type.Optional(Type.Number({ description: 'Max rows to return. Defaults to 100.' })),
});

export const excelReadTool: ToolDefinition = {
  name: 'excel_read',
  label: 'Read Excel/CSV',
  description: [
    'Read an Excel (.xlsx, .xls, .xlsm) or CSV file with full metadata extraction:',
    '- Merged cells: automatically unmerged and filled',
    '- Header row: auto-detected (handles multi-row Korean headers)',
    '- Formatting: bold (B), italic (I), background colors per row in _style column',
    '- Formulas: captured per column (e.g. "=D2*E2" reveals business logic)',
    '- Color legend: explains what each background color likely means',
    '- Number formats: shows currency, percentage, decimal patterns',
  ].join('\n'),
  promptSnippet: 'Read Excel/CSV with merged-cell handling, formatting, and formula extraction.',
  promptGuidelines: [
    'Use excel_read to fully understand a spreadsheet before analysis.',
    'The _style column shows formatting: "B" = bold (headers/totals), "I" = italic, "bg:#EFEFEF" = colored background.',
    'The "formulas" field shows how computed columns are calculated — this reveals business logic (e.g. "=F2-G2" means column H = F minus G).',
    'Korean financial Excel uses colors semantically: yellow = active/current, orange = estimated, gray = subtotal/header.',
    'Check formulas to understand which columns are inputs vs derived values.',
  ],
  parameters: ExcelReadParams,

  async execute(_id: string, params: { path: string; sheet?: string; rows?: number }) {
    const { path: filePath, sheet, rows = 100 } = params;
    ensureReaderScript();
    const sheetArg = sheet ? JSON.stringify(sheet) : 'None';

    const pyScript = `
import json, sys
sys.path.insert(0, '/tmp')
from tower_excel_reader import smart_read
try:
    df, meta = smart_read(${JSON.stringify(filePath)}, sheet_name=${sheetArg}, max_rows=${rows})
    cols = [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns]
    meta["columns"] = cols
    meta["data"] = json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))
    print(json.dumps(meta, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

    try {
      const result = execSync(`python3 -c ${JSON.stringify(pyScript)}`, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${parsed.error}` }], details: undefined };
      }
      const { file, shape, columns: cols, data, sheets, merged_fixed, header_row,
              sheet: sheetName, color_legend, number_formats, formulas } = parsed;

      const metaLine = [
        `**${file}**`,
        sheetName ? `sheet: ${sheetName}` : '',
        `${shape[0]} rows × ${shape[1]} columns`,
        sheets ? `Sheets: ${sheets.join(', ')}` : '',
        merged_fixed > 0 ? `(${merged_fixed} merged ranges fixed)` : '',
        header_row > 0 ? `(header at row ${header_row})` : '',
      ].filter(Boolean).join(' — ');

      const lines = [metaLine, ''];

      // Formulas — business logic
      if (formulas && Object.keys(formulas).length > 0) {
        lines.push('**Formulas (business logic):**');
        for (const [col, formula] of Object.entries(formulas)) {
          lines.push(`  ${col}: \`${formula}\``);
        }
        lines.push('');
      }

      // Color legend
      if (color_legend && Object.keys(color_legend).length > 0) {
        lines.push('**Color Legend:**');
        for (const [color, meaning] of Object.entries(color_legend)) {
          lines.push(`  ${color}: ${meaning}`);
        }
        lines.push('');
      }

      // Number formats
      if (number_formats && Object.keys(number_formats).length > 0) {
        lines.push('**Number Formats:** ' + Object.entries(number_formats).map(([fmt, n]) => `\`${fmt}\` (${n})`).join(', '));
        lines.push('');
      }

      lines.push('Columns: ' + cols.map((c: any) => `${c.name} (${c.dtype})`).join(', '));
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(data, null, 2).slice(0, 8000));
      lines.push('```');
      if (shape[0] > rows) lines.push(`\n(showing first ${rows} of ${shape[0]} rows)`);

      return { content: [{ type: 'text' as const, text: lines.join('\n') }], details: undefined };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `excel_read failed: ${err.message}` }], details: undefined };
    }
  },
} as ToolDefinition;


// ═══════════════════════════════════════════════════════════════
// excel_query — Run pandas operations on a pre-cleaned spreadsheet
// ═══════════════════════════════════════════════════════════════

const ExcelQueryParams = Type.Object({
  path: Type.String({ description: 'Path to the Excel or CSV file' }),
  query: Type.String({ description: 'Pandas expression on DataFrame `df`. Examples: "df.describe()", "df.groupby(\'Category\').sum()", "df[df._style.str.contains(\'B\')]" to find bold/header rows' }),
  sheet: Type.Optional(Type.String({ description: 'Sheet name (Excel only)' })),
});

export const excelQueryTool: ToolDefinition = {
  name: 'excel_query',
  label: 'Query Excel/CSV',
  description: 'Run a pandas expression on a pre-cleaned Excel/CSV file. The DataFrame `df` has merged cells unmerged, auto-detected headers, and a _style column with formatting info. Use df[df._style.str.contains("B")] to find bold rows (usually headers/totals).',
  promptSnippet: 'Run pandas queries on pre-cleaned Excel/CSV data with formatting-aware filtering.',
  promptGuidelines: [
    'The DataFrame `df` is pre-cleaned: merged cells unmerged, header auto-detected, empty rows/columns removed.',
    'The _style column lets you filter by formatting: df[df._style.str.contains("B")] = bold rows, df[df._style.str.contains("bg:")] = colored rows.',
    'For financial analysis: df.describe(), df.groupby(...).agg(...), df.pivot_table(...), df.corr().',
  ],
  parameters: ExcelQueryParams,

  async execute(_id: string, params: { path: string; query: string; sheet?: string }) {
    const { path: filePath, query, sheet } = params;
    ensureReaderScript();
    const sheetArg = sheet ? JSON.stringify(sheet) : 'None';

    const pyScript = `
import sys
sys.path.insert(0, '/tmp')
import pandas as pd
from tower_excel_reader import smart_read
try:
    df, meta = smart_read(${JSON.stringify(filePath)}, sheet_name=${sheetArg}, max_rows=10000)
    result = eval(${JSON.stringify(query)})
    if isinstance(result, pd.DataFrame):
        print(result.head(200).to_string())
    elif isinstance(result, pd.Series):
        print(result.head(200).to_string())
    else:
        print(str(result))
except Exception as e:
    print(f"Error: {e}")
`.trim();

    try {
      const result = execSync(`python3 -c ${JSON.stringify(pyScript)}`, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
      });
      const truncated = result.length > 10000 ? result.slice(0, 10000) + '\n...(truncated)' : result;
      return { content: [{ type: 'text' as const, text: truncated }], details: undefined };
    } catch (err: any) {
      return { content: [{ type: 'text' as const, text: `excel_query failed: ${err.message}` }], details: undefined };
    }
  },
} as ToolDefinition;
