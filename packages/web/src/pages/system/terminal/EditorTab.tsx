import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Button, Toast, Spin, Typography } from '@douyinfe/semi-ui';
import { Save } from 'lucide-react';
import type { editor } from 'monaco-editor';
import { request } from '@/utils/request';
import { useThemeController } from '@/providers/theme-controller';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme, toMonacoTheme, monacoThemeName } from './themes';
import { editableFileDownloadUrl, useFileContent, useSaveFileContent, type EditableFileRef } from '@/hooks/queries/terminal-files';

interface EditorTabProps {
  readonly filePath: string;
  readonly active: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby',
  sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql',
  toml: 'ini', ini: 'ini', conf: 'ini', env: 'ini', vue: 'html', svelte: 'html',
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif']);

function isImageFile(filePath: string): boolean {
  const ext = (filePath.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext);
}

/** 带鉴权获取图片 blob URL */
async function fetchImageBlobUrl(downloadUrl: string): Promise<string> {
  // 走统一 request：裸 fetch 会绕过 401 刷新、错误上报与 Demo 模式
  const blob = await request.getBlob(downloadUrl);
  if (!blob) throw new Error('image load failed');
  return URL.createObjectURL(blob);
}

/** 图片预览面板 */
function ImagePreview({ filePath, downloadUrl }: { readonly filePath: string; readonly downloadUrl: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  useEffect(() => {
    let revoke = '';
    setImgUrl(null);
    setError(false);
    fetchImageBlobUrl(downloadUrl)
      .then((url) => { revoke = url; setImgUrl(url); })
      .catch(() => setError(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [downloadUrl]);

  let body: React.ReactNode;
  if (error) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <Typography.Text type="danger">图片加载失败</Typography.Text>
        <Typography.Text size="small" type="tertiary">{fileName}</Typography.Text>
      </div>
    );
  } else if (imgUrl) {
    body = <img src={imgUrl} alt={fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }} />;
  } else {
    body = <Spin size="large" />;
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-card)' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>
          {filePath}
        </Typography.Text>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {body}
      </div>
    </div>
  );
}

function detectLanguage(filePath: string): string {
  const name = (filePath.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'plaintext';
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return LANGUAGE_MAP[ext] ?? 'plaintext';
}

type FileKind = 'local' | 'docker' | 'sftp';

interface FileRef {
  kind: FileKind;
  /** 用于显示与语言检测的真实路径 */
  displayPath: string;
  readOnly: boolean;
  /** 契约层的文件引用（读取 / 保存 / 下载都由它派生） */
  source: EditableFileRef;
  downloadUrl: string;
}

/** 解析文件引用：local 普通路径 / docker:// 容器只读 / sftp:// 远程可写 */
function parseFileRef(filePath: string): FileRef {
  if (filePath.startsWith('docker://')) {
    const withoutScheme = filePath.slice('docker://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    const containerId = slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
    const containerPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : '/';
    const source: EditableFileRef = { kind: 'docker', containerId, path: containerPath };
    return { kind: 'docker', displayPath: containerPath, readOnly: true, source, downloadUrl: editableFileDownloadUrl(source) };
  }
  if (filePath.startsWith('sftp://')) {
    const withoutScheme = filePath.slice('sftp://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    const profileId = Number(slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme);
    const remotePath = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : '/';
    const source: EditableFileRef = { kind: 'sftp', profileId, path: remotePath };
    return { kind: 'sftp', displayPath: remotePath, readOnly: false, source, downloadUrl: editableFileDownloadUrl(source) };
  }
  const source: EditableFileRef = { kind: 'local', path: filePath };
  return { kind: 'local', displayPath: filePath, readOnly: false, source, downloadUrl: editableFileDownloadUrl(source) };
}

export default function EditorTab({ filePath, active, onDirtyChange }: EditorTabProps) {
  const fileRef = useMemo(() => parseFileRef(filePath), [filePath]);
  const isImg = fileRef.kind !== 'docker' && isImageFile(fileRef.displayPath);

  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();

  const theme = useMemo(
    () => resolveTheme(isDark ? terminal.themeDark : terminal.themeLight, isDark ? 'dark' : 'light'),
    [isDark, terminal.themeDark, terminal.themeLight],
  );
  const themeName = monacoThemeName(theme);

  const [content, setContent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const savedRef = useRef('');
  /** 读取时拿到的文件版本，保存时回传用于并发冲突检测 */
  const etagRef = useRef<string | undefined>(undefined);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const contentQuery = useFileContent(fileRef.source, active && !isImg);
  const saveMutation = useSaveFileContent(fileRef.source);

  useEffect(() => {
    if (isImg) return;
    setContent(null);
    setDirty(false);
    onDirtyChangeRef.current?.(false);
  }, [filePath, isImg]);

  // 加载文件内容（仅依赖 filePath，图片文件跳过）
  useEffect(() => {
    if (isImg || !contentQuery.data || dirty) return;
    const text = contentQuery.data.content ?? '';
    etagRef.current = contentQuery.data.etag;
    savedRef.current = text;
    setContent(text);
    setDirty(false);
    onDirtyChangeRef.current?.(false);
  }, [contentQuery.data, dirty, isImg]);

  // 注册并应用自定义主题（与终端配色一致）
  useEffect(() => {
    const m = monacoRef.current;
    if (!m) return;
    m.editor.defineTheme(themeName, toMonacoTheme(theme));
    m.editor.setTheme(themeName);
  }, [theme, themeName]);

  // tab 激活时重新布局
  useEffect(() => {
    if (active) {
      const t = setTimeout(() => editorRef.current?.layout(), 50);
      return () => clearTimeout(t);
    }
  }, [active]);

  const handleSave = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || fileRef.readOnly) return;
    const value = ed.getValue();
    // 带上读取时的版本：服务端据此拒绝覆盖他人在此期间的修改
    await saveMutation.mutateAsync({ content: value, baseEtag: etagRef.current });
    // 保存响应为目录项（不含版本标识）；后续保存不再携带 baseEtag，直至重新读取
    etagRef.current = undefined;
    savedRef.current = value;
    setDirty(false);
    onDirtyChangeRef.current?.(false);
    Toast.success('已保存');
  }, [fileRef, saveMutation]);
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    monaco.editor.defineTheme(themeName, toMonacoTheme(theme));
    monaco.editor.setTheme(themeName);
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleSaveRef.current();
    });
  };

  const handleChange = (v: string | undefined) => {
    const d = (v ?? '') !== savedRef.current;
    if (d !== dirty) {
      setDirty(d);
      onDirtyChangeRef.current?.(d);
    }
  };

  // 图片文件：直接渲染预览，跳过 Monaco
  if (isImg) {
    return <ImagePreview filePath={fileRef.displayPath} downloadUrl={fileRef.downloadUrl} />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="terminal-editor-header">
        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>
          {fileRef.kind === 'sftp' ? `🌐 ${fileRef.displayPath}` : fileRef.displayPath}
          {dirty ? ' ●' : ''}
        </Typography.Text>
        {!fileRef.readOnly && (
          <Button
            size="small"
            theme="solid"
            type="primary"
            icon={<Save size={13} />}
            loading={saveMutation.isPending}
            disabled={!dirty}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        )}
        {fileRef.readOnly && (
          <Typography.Text size="small" type="tertiary" style={{ marginLeft: 4 }}>只读</Typography.Text>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {contentQuery.isFetching && content === null ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        ) : (
          <Editor
            height="100%"
            language={detectLanguage(fileRef.displayPath)}
            theme={themeName}
            defaultValue={content ?? ''}
            onChange={handleChange}
            onMount={handleMount}
            options={{
              fontSize: terminal.fontSize,
              fontFamily: terminal.fontFamily,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              readOnly: fileRef.readOnly,
            }}
          />
        )}
      </div>
    </div>
  );
}
