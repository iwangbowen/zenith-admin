/**
 * Monaco Editor 只读预览面板。
 * 用于在 FilePreviewModal 中替换 MarkdownPreviewPanel rawText 模式，
 * 提供带语法高亮的代码文件预览。
 */
import type { CSSProperties } from 'react';
import Editor from '@monaco-editor/react';
import { useThemeController } from '@/providers/theme-controller';
import { monacoLanguageByExt } from '@/utils/monaco-language';

interface MonacoPreviewPanelProps {
  /** 文件内容 */
  readonly content: string;
  /** 文件名，用于自动检测语言 */
  readonly fileName?: string;
  readonly style?: CSSProperties;
}

export default function MonacoPreviewPanel({ content, fileName, style }: Readonly<MonacoPreviewPanelProps>) {
  const { isDark } = useThemeController();

  const language = monacoLanguageByExt(fileName?.split('.').pop() ?? '');

  return (
    <div style={{ flex: 1, minHeight: 0, ...style }}>
      <Editor
        value={content}
        language={language}
        theme={isDark ? 'vs-dark' : 'light'}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 13,
          lineNumbers: 'on',
          folding: true,
          renderLineHighlight: 'none',
          automaticLayout: true,
          contextmenu: false,
          scrollbar: { vertical: 'auto', horizontal: 'auto' },
        }}
        height="100%"
      />
    </div>
  );
}
