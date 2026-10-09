import { useMemo } from 'react';
import FileViewer from '@file-viewer/react';
import { archiveRenderer } from '@file-viewer/renderer-archive';
import { presentationRenderer } from '@file-viewer/renderer-presentation';
import pptxWorkerUrl from '@file-viewer/pptx/worker/pptx.worker.js?url';
import archiveWorkerUrl from 'libarchive.js/dist/worker-bundle.js?url';
import archiveWasmUrl from 'libarchive.js/dist/libarchive.wasm?url';
import { configuredFileViewerRenderers } from 'virtual:file-viewer-renderers';
import { useThemeController } from '@/providers/theme-controller';
import { isSpreadsheetFile, resolveFileMimeType } from '@/utils/file-utils';
import type { CSSProperties } from 'react';
import type { ViewerOptions } from '@file-viewer/react';

interface FileViewerPreviewPanelProps {
  readonly file: File;
  readonly style?: CSSProperties;
}

const fileViewerRenderers = [
  ...(Array.isArray(configuredFileViewerRenderers)
    ? configuredFileViewerRenderers
    : [configuredFileViewerRenderers]),
  archiveRenderer,
  presentationRenderer,
] as ViewerOptions['renderers'];

/** 文件浏览器端只读预览，不依赖外部预览或转换服务。 */
export default function FileViewerPreviewPanel({ file, style }: FileViewerPreviewPanelProps) {
  const { isDark } = useThemeController();
  // 表格渲染器的暗色主题不会调和文件内嵌样式（如导出文件的黑字、浅灰表头填充），
  // 会出现黑字压暗底 / 亮字压浅底的不可读组合，因此表格预览恒用亮色渲染
  const isSpreadsheet = isSpreadsheetFile(resolveFileMimeType(file.type, file.name));
  const useDarkTheme = isDark && !isSpreadsheet;
  const options = useMemo<ViewerOptions>(() => ({
    theme: useDarkTheme ? 'dark' : 'light',
    locale: 'zh-CN',
    styleIsolation: 'shadow',
    rendererMode: 'replace',
    autoRenderers: false,
    renderers: fileViewerRenderers,
    ui: { density: 'compact' },
    toolbar: {
      position: 'top-center',
      download: false,
      print: true,
      exportHtml: false,
      zoom: true,
      search: true,
      theme: false,
    },
    docx: {
      worker: true,
      visualPagination: true,
    },
    presentation: {
      workerUrl: pptxWorkerUrl,
      workerType: 'module',
    },
    spreadsheet: {
      worker: 'auto',
      textEncoding: 'auto',
      resizableColumns: true,
      resizableRows: true,
    },
    archive: {
      workerUrl: archiveWorkerUrl,
      wasmUrl: archiveWasmUrl,
    },
    drawing: {
      // vite-plugin 的 copyAssets 不分发 vendor/drawio/viewer-static.min.js（仅 full 包带），
      // 走官方 diagrams.net viewer 只会 404 后等超时再回退，这里直接使用内置离线 SVG 渲染。
      preferOfficial: false,
    },
    geo: {
      // 默认即离线空底图；显式声明避免将来默认值变化后悄悄请求外部瓦片服务
      // （OpenFreeMap / OSM / 天地图 均需显式配置才会启用）。
      basemap: 'offline',
    },
  }), [useDarkTheme]);

  return (
    <div style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, ...style }}>
      <FileViewer file={file} options={options} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
