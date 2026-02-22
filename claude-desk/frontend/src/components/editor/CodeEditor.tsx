import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { EditorView, keymap } from '@codemirror/view';

interface CodeEditorProps {
  value: string;
  language?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

const languageExtensions: Record<string, () => any> = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  json: () => json(),
  markdown: () => markdown(),
  html: () => html(),
  css: () => css(),
};

const bgTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(255,255,255,0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
});

export function CodeEditor({ value, language, onChange, onSave, readOnly = false }: CodeEditorProps) {
  const extensions = useMemo(() => {
    const exts = [bgTheme];
    const langFactory = language ? languageExtensions[language] : null;
    if (langFactory) exts.push(langFactory());
    if (onSave) {
      exts.push(
        keymap.of([{
          key: 'Mod-s',
          run: () => { onSave(); return true; },
        }])
      );
    }
    return exts;
  }, [language, onSave]);

  return (
    <CodeMirror
      value={value}
      theme={oneDark}
      extensions={extensions}
      onChange={onChange}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        bracketMatching: true,
        autocompletion: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
      }}
      style={{ height: '100%', fontSize: '13px' }}
    />
  );
}
