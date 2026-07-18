import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { PDFViewer, ZoomMode } from '@embedpdf/react-pdf-viewer';
import type { PDFViewerRef, PluginRegistry } from '@embedpdf/react-pdf-viewer';
// 本地加载 PDFium WASM：经 npm 安装，dev 与生产构建均由 Vite 处理为本地资源，
// 避免运行时从 jsDelivr CDN 拉取 pdfium.wasm。
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { Button, Select, Typography } from '@douyinfe/semi-ui';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { Icon } from '@iconify/react';
import { useThemeController } from '@/providers/theme-controller';

const { Text } = Typography;

// Vite 的 `?url` 在 dev 下返回根相对路径（如 /@fs/...），生产构建下返回带 base 前缀的
// 资源路径。EmbedPDF 会在一个 blob: URL 的 Web Worker 内 fetch 该地址，而 blob: 基址
// 无法解析根相对/相对路径，因此必须转换为带 origin 的绝对 URL（dev 与生产均适用）。
const pdfiumWasmAbsUrl = new URL(pdfiumWasmUrl, globalThis.location.origin).href;

type ZoomLevel = ZoomMode | number;

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: ZoomMode.Automatic, label: '自动缩放' },
  { value: ZoomMode.FitPage,   label: '适合页高' },
  { value: ZoomMode.FitWidth,  label: '适合页宽' },
  { value: 1,                  label: '实际大小' },
];

/** 读取文档上当前生效的 CSS 变量值（fallback 备用值） */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

interface PDFPreviewPanelProps {
  readonly file: File;
  readonly onClose: () => void;
  readonly fullscreen?: boolean;
  readonly onToggleFullscreen?: () => void;
  readonly style?: CSSProperties;
}

export function PDFPreviewPanel({ file, onClose, fullscreen, onToggleFullscreen, style }: PDFPreviewPanelProps) {
  const viewerRef = useRef<PDFViewerRef>(null);
  const registryRef = useRef<PluginRegistry | null>(null);
  const { isDark } = useThemeController();
  const [zoomMode, setZoomMode] = useState<ZoomLevel>(ZoomMode.FitWidth);

  const handleReady = useCallback((registry: PluginRegistry) => {
    registryRef.current = registry;
  }, []);

  const handleZoomChange = useCallback(async (level: ZoomLevel) => {
    setZoomMode(level);
    const registry = registryRef.current;
    if (!registry) return;

    type DocManagerAPI = { getActiveDocumentId: () => string | null };
    type ZoomAPI = { forDocument: (id: string) => { requestZoom: (l: ZoomLevel) => void } | null };

    const docManager = (registry.getPlugin('document-manager') as { provides: () => DocManagerAPI } | null)?.provides();
    const docId = docManager?.getActiveDocumentId();
    if (!docId) return;

    const zoomPlugin = (registry.getPlugin('zoom') as { provides: () => ZoomAPI } | null)?.provides();
    zoomPlugin?.forDocument(docId)?.requestZoom(level);
  }, []);

  // 读取当前 Semi Design CSS 变量，构建贴合主题的颜色配置
  const themeConfig = useMemo(() => {
    const primary      = cssVar('--semi-color-primary',              '#3370ff');
    const primaryHover = cssVar('--semi-color-primary-hover',        '#2860e1');
    const primaryAct   = cssVar('--semi-color-primary-active',       '#1d4ed8');
    const primaryLight = cssVar('--semi-color-primary-light-default','rgba(51,112,255,0.1)');
    const bg0    = cssVar('--semi-color-bg-0',   isDark ? '#000000'              : '#ffffff');
    const bg1    = cssVar('--semi-color-bg-1',   isDark ? '#1c1d24'              : '#ffffff');
    const bg2    = cssVar('--semi-color-bg-2',   isDark ? '#35363c'              : '#f5f5f5');
    const fill0  = cssVar('--semi-color-fill-0', isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)');
    const border = cssVar('--semi-color-border',  isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)');
    const text0  = cssVar('--semi-color-text-0',  isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.88)');
    const text1  = cssVar('--semi-color-text-1',  isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)');
    const text2  = cssVar('--semi-color-text-2',  isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');

    const tokens = {
      accent: {
        primary,
        primaryHover,
        primaryActive: primaryAct,
        primaryLight,
        primaryForeground: '#fff',
      },
      background: {
        app:        bg0,
        surface:    bg1,
        surfaceAlt: bg2,
        elevated:   bg2,
        input:      fill0,
      },
      foreground: {
        primary:   text0,
        secondary: text1,
        muted:     text1,
        disabled:  text2,
        onAccent:  '#fff',
      },
      border: {
        default: border,
        subtle:  border,
        strong:  border,
      },
    };

    return {
      preference: isDark ? 'dark' : 'light',
      light: tokens,
      dark:  tokens,
    };
  }, [isDark]);

  useEffect(() => {
    if (!file) return;

    const loadFile = async () => {
      const buffer = await file.arrayBuffer();
      const registry = await viewerRef.current?.registry;
      if (!registry) return;

      type DocManagerAPI = {
        openDocumentBuffer: (opts: { buffer: ArrayBuffer; name: string; autoActivate: boolean }) => void;
        closeAllDocuments: () => void;
      };
      const plugin = registry.getPlugin('document-manager');
      if (!plugin) return;
      const docManager = (plugin as { provides: () => DocManagerAPI }).provides();

      docManager.closeAllDocuments();
      docManager.openDocumentBuffer({
        buffer,
        name: file.name,
        autoActivate: true,
      });
    };

    loadFile();
  }, [file]);

  return (
    <div
      style={{
        width: '50%',
        minWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--semi-color-border)',
        background: 'var(--semi-color-bg-0)',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    >
      {/* 顶栏：文件名 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-bg-1)',
          flexShrink: 0,
        }}
      >
        <Icon icon="vscode-icons:file-type-pdf2" width={15} height={15} style={{ flexShrink: 0 }} />
        <Text
          ellipsis={{ showTooltip: true }}
          style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}
        >
          {file.name}
        </Text>
        <Select
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value={zoomMode as any}
          onChange={(v) => handleZoomChange(v as ZoomLevel)}
          size="small"
          style={{ width: 96, flexShrink: 0 }}
          optionList={ZOOM_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        {onToggleFullscreen && (
          <Button
            theme="borderless"
            size="small"
            icon={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }}
            onClick={onToggleFullscreen}
          />
        )}
        <Button
          theme="borderless"
          size="small"
          icon={<X size={14} />}
          style={{ flexShrink: 0, color: 'var(--semi-color-text-2)' }}
          onClick={onClose}
        />
      </div>

      {/* PDF 预览区 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <PDFViewer
          key={isDark ? 'dark' : 'light'}
          ref={viewerRef}
          onReady={handleReady}
          config={{
            theme: themeConfig,
            // 本地 npm 资源（绝对 URL），替代默认的 jsDelivr CDN wasm
            wasmUrl: pdfiumWasmAbsUrl,
            zoom: { defaultZoomLevel: ZoomMode.FitWidth },
            i18n: { defaultLocale: 'zh-CN' },
            tabBar: 'never',
            disabledCategories: ['annotation', 'form', 'redaction', 'insert', 'signature'],
            // 只读预览不使用印章/批注，禁用默认印章清单，避免从 jsDelivr CDN
            // 拉取 default-stamps 的 manifest.json 与 stamps.pdf。
            stamp: { manifests: [] },
            // 关闭查看器 UI 默认从 Google Fonts 加载的 Open Sans 字体（国内被墙会导致
            // 渲染阻塞、工具栏文字延迟）。置 null 后回退系统字体栈，中文 UI 视觉无影响。
            fonts: { ui: null, signature: null },
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
