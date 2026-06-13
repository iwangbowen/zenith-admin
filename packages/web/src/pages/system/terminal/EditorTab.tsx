import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Button, Toast, Spin, Typography } from '@douyinfe/semi-ui';
import { Save } from 'lucide-react';
import type { editor } from 'monaco-editor';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { request } from '@/utils/request';
import { useThemeController } from '@/providers/theme-controller';
import { useTerminalPreferences } from './useTerminalPreferences';
import { resolveTheme, toMonacoTheme, monacoThemeName } from './themes';

interface EditorTabProps {
  readonly filePath: string;
  readonly active: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
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
async function fetchImageBlobUrl(filePath: string): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const base = config.apiBaseUrl || '';
  const url = `${base}/api/terminal-files/download?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** 图片预览面板 */
function ImagePreview({ filePath }: { readonly filePath: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  useEffect(() => {
    let revoke = '';
    setImgUrl(null);
    setError(false);
    fetchImageBlobUrl(filePath)
      .then((url) => { revoke = url; setImgUrl(url); })
      .catch(() => setError(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [filePath]);

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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--semi-color-bg-1)' }}>
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

export default function EditorTab({ filePath, active, onDirtyChange }: EditorTabProps) {
  // docker:// 前缀：容器内文件，只读模式
  const isDockerFile = filePath.startsWith('docker://');
  const isImg = !isDockerFile && isImageFile(filePath);

  const { isDark } = useThemeController();
  const { terminal } = useTerminalPreferences();

  const theme = useMemo(
    () => resolveTheme(isDark ? terminal.themeDark : terminal.themeLight, isDark ? 'dark' : 'light'),
    [isDark, terminal.themeDark, terminal.themeLight],
  );
  const themeName = monacoThemeName(theme);

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const savedRef = useRef('');
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  // 加载文件内容（仅依赖 filePath，图片文件跳过）
  useEffect(() => {
    if (isImg) return;
    let cancelled = false;
    setLoading(true);

    let fetchPromise: Promise<{ code: number; data?: FileContent | { content: string } | null }>;
    if (isDockerFile) {
      // docker://<containerId>/path/to/file
      const withoutScheme = filePath.slice('docker://'.length);
      const slashIdx = withoutScheme.indexOf('/');
      const containerId = slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
      const containerPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : '/';
      fetchPromise = request.get<{ content: string }>(
        `/api/docker/${containerId}/files/content?path=${encodeURIComponent(containerPath)}`,
      );
    } else {
      fetchPromise = request.get<FileContent>(`/api/terminal-files/content?path=${encodeURIComponent(filePath)}`);
    }

    fetchPromise
      .then((res) => {
        if (cancelled) return;
        const text = res.code === 0 && res.data ? (res.data as FileContent).content ?? (res.data as { content: string }).content : '';
        savedRef.current = text;
        setContent(text);
        setDirty(false);
        onDirtyChangeRef.current?.(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, isImg, isDockerFile]);

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
    if (!ed) return;
    const value = ed.getValue();
    setSaving(true);
    const res = await request.put<FileContent>('/api/terminal-files/content', { path: filePath, content: value });
    setSaving(false);
    if (res.code === 0) {
      savedRef.current = value;
      setDirty(false);
      onDirtyChangeRef.current?.(false);
      Toast.success('已保存');
    }
  }, [filePath]);
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
    return <ImagePreview filePath={filePath} />;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderBottom: '1px solid var(--semi-color-border)',
          flexShrink: 0,
        }}
      >
        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>
          {filePath}
          {dirty ? ' ●' : ''}
        </Typography.Text>
        {!isDockerFile && (
          <Button
            size="small"
            theme="solid"
            type="primary"
            icon={<Save size={13} />}
            loading={saving}
            disabled={!dirty}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        )}
        {isDockerFile && (
          <Typography.Text size="small" type="tertiary" style={{ marginLeft: 4 }}>只读</Typography.Text>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        ) : (
          <Editor
            height="100%"
            language={detectLanguage(filePath)}
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
              readOnly: isDockerFile,
            }}
          />
        )}
      </div>
    </div>
  );
}
