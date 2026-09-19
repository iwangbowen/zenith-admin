# 文件预览组件

`FilePreviewModal` 是全站统一的非图片文件预览弹窗。托管文件列表页推荐使用 `useFilePreview`（`@/hooks/useFilePreview`）+ `FilePreviewLayer`（`@/components/FilePreviewLayer`）：图片走 Semi `ImagePreview` 图集，可预览的非图片走 `FilePreviewModal`，不可预览文件拉取 Blob 后新窗口打开，下载同样复用鉴权读取。

**文件位置**：`packages/web/src/components/FilePreviewModal/`

---

## 支持的文件格式

| 格式 | MIME / 扩展名 | 渲染方式 |
| --- | --- | --- |
| 普通图片 | `image/*`，排除 PSD | 调用方的 Semi `ImagePreview` 图集 |
| HEIC / HEIF / TIFF | `.heic` / `.heif` / `.tif` / `.tiff` | `image-decode` 转 PNG 后进入图集 |
| PDF | `application/pdf` | `PDFPreviewPanel`（`@embedpdf/react-pdf-viewer`） |
| OFD | `.ofd` / `application/ofd` / `application/vnd.ofd` | `FileViewerPreviewPanel` 的 OFD renderer |
| 音频 | `audio/*` | Semi `AudioPlayer` 底部播放条 |
| 视频 | `video/*` | Semi `VideoPlayer` 弹窗 |
| 表格 | xls/xlsx/xlt/xltx/xlsm/xlsb/xltm/csv/tsv/ods/fods/numbers | File Viewer Spreadsheet renderer |
| 文本文档 | doc/docx/docm/dot/dotx/dotm/odt/rtf | File Viewer Word renderer |
| 演示文稿 | ppt/pptx/pptm/potx/potm/ppsx/ppsm/odp | File Viewer Presentation renderer |
| 压缩包 | zip/7z/rar/tar/gz/xz/zst/cab/iso/jar/apk/cbz/cbr 等 | File Viewer Archive renderer |
| 邮件 | eml/msg/mbox | File Viewer Email renderer |
| XMind | xmind | File Viewer Mind Map renderer |
| 图形 | drawio/dio/excalidraw/mermaid/mmd/plantuml/puml | File Viewer Drawing renderer |
| Markdown | `text/markdown` / `text/x-markdown` | `MarkdownPreviewPanel`（react-markdown） |
| 纯文本 | `text/plain` | `MonacoPreviewPanel` 只读展示 |
| JSON | `application/json` / `text/json` | `JsonPreviewPanel`（Semi `JsonViewer`） |
| SVG | `image/svg+xml` | Blob Object URL + `<img>` |
| 代码/配置 | JS/TS/Python/CSS/HTML/XML/YAML/Shell/SQL 等 MIME | `MonacoPreviewPanel` 语法高亮 |
| 字体 / 设计 / 结构化数据 | ttf/otf/woff/woff2、PSD、SQLite、Parquet、WASM | File Viewer Data renderer |
| 地理数据 | GeoJSON、KML、GPX、SHP | File Viewer Geo renderer（离线空底图） |

> 普通图片不在 `FilePreviewModal` 内部渲染。`FilePreviewModal` 遇到可图集展示的 `image/*` 会关闭自身；调用方使用 `FilePreviewLayer` 时由 Semi `ImagePreview` 承接。
>
> PSD 的规范 MIME 是 `image/vnd.adobe.photoshop`，以 `image/` 开头，但必须走 Data renderer。判断图集图片使用 `isGalleryImageFile`，不要用 `mimeType.startsWith('image/')`。
>
> 二进制 `.ppt` 由 File Viewer 的 PPT 引擎渲染，公开运行时带水印；`.pptx` 不受此限制。OFD 使用纯前端 `ofd.js`，仅展示电子签章外观，不提供国密验签结论。

---

## Props

`FilePreviewModal` props 与源码 `components/FilePreviewModal/index.tsx` 保持一致：

| Prop | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileUrl` | `string` | 是 | 文件访问 URL，通常为 `/api/files/{id}/content` |
| `fileName` | `string` | 否 | 标题栏文件名，默认 `文件` |
| `mimeType` | `string \| null` | 否 | MIME 类型；缺失或通用二进制类型时按文件名扩展名回退 |
| `visible` | `boolean` | 是 | 控制弹窗显示 |
| `onClose` | `() => void` | 是 | 关闭回调 |
| `onFallback` | `(fileUrl, fileName, mimeType) => void` | 否 | 不支持预览时触发；未传时静默关闭 |
| `style` | `CSSProperties` | 否 | 预留样式参数 |

---

## 使用示例

### 托管文件列表：useFilePreview + FilePreviewLayer

```tsx
import { useFilePreview } from '@/hooks/useFilePreview';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';

const preview = useFilePreview(() => data?.list ?? []);

<Button loading={preview.previewLoadingId === record.id} onClick={() => void preview.handlePreview(record)}>
  预览
</Button>
<Button loading={preview.downloadLoadingId === record.id} onClick={() => void preview.handleDownload(record)}>
  下载
</Button>

<FilePreviewLayer preview={preview} />
```

`useFilePreview(getImageFiles)` 返回图集状态、当前非图片预览目标、`handlePreview`、`handleDownload`、`closeImagePreview`、`closeFilePreview`、`resetPreview`。数据源切换时调用 `resetPreview()` 可关闭在途预览。

### 直接使用 FilePreviewModal

```tsx
import FilePreviewModal from '@/components/FilePreviewModal';

<FilePreviewModal
  fileUrl={preview?.url ?? ''}
  fileName={preview?.name}
  mimeType={preview?.mimeType}
  visible={!!preview}
  onClose={() => setPreview(null)}
/>
```

### 使用 canPreviewFile 控制入口

```tsx
import { canPreviewFile } from '@/utils/file-utils';

const isPreviewable = canPreviewFile(record.mimeType, record.originalName);
```

`canPreviewFile` 覆盖图片、音视频、PDF、OFD、Office、OpenDocument、邮件、XMind、图形、数据资产、地理数据、Markdown、文本、JSON、SVG、代码与压缩包。

---

## 内容获取与缓存

预览统一通过 `fetchManagedFileBlob(fileUrl)` 获取 Blob：

1. 能从 URL 解析出 `/api/files/{id}/content` 时，先调用 `getFileAccessUrl(id)` 换取访问直链
2. 直链读取失败或无法解析托管文件 ID 时，降级为携带认证头的 `fetchProtectedFile(url)`
3. 绝对 URL 按直链裸 fetch；相对 URL 经 `request.fetchRaw` 携带当前后台登录态读取

弹窗内部用 TanStack Query 管理加载状态，query key 为 `['files', 'preview', visible, fileUrl, fileName, resolvedMimeType, previewKind]`，`staleTime: 0`、`gcTime: 0`，文件内容不做持久缓存。加载失败时 Toast 提示并关闭弹窗。

---

## 各格式实现细节

### PDF

`PDFPreviewPanel` 使用本地引入的 `@embedpdf/pdfium/pdfium.wasm?url`，并转成带 origin 的绝对 URL 供 Worker 获取。`PDFViewer` 配置关闭默认印章资源和字体外联，UI 字体回退系统字体。PDF 面板跟随应用明暗主题，宽度 `min(1100px, 92vw)`，高度 88vh。

当 PDF 含未内嵌字体时，EmbedPDF 的字体 fallback 仍可能需要额外本地字体包；内网零外联部署需额外配置 `fontFallback`。

### 音频 / 视频

音频下载为 Object URL 后通过 Portal 固定在页面底部播放，关闭时释放 URL；视频在 `AppModal` 中播放，宽度 `min(960px, 92vw)`。

### Markdown / 文本 / 代码 / JSON / SVG

- Markdown 使用 `react-markdown` + `remark-gfm` + `rehype-highlight`，不启用 `rehype-raw`，HTML 按文本处理
- 文本与代码使用 `MonacoPreviewPanel`，根据扩展名选择语言；`.ts` / `.tsx` 即使 MIME 为 `video/mp2t` 也按代码处理
- JSON 使用 Semi `JsonViewer`，解析失败降级为等宽原始文本
- SVG 使用 Blob Object URL + `<img>`，关闭时释放 URL

### Office / OFD / 压缩包 / 邮件 / XMind / 图形 / 数据资产 / 地理数据

这些格式下载 Blob 后包装为 `File`，再懒加载 `FileViewerPreviewPanel`。面板显式注册以下 renderer：

```text
@file-viewer/renderer-archive
@file-viewer/renderer-drawing
@file-viewer/renderer-email
@file-viewer/renderer-mindmap
@file-viewer/renderer-ofd
@file-viewer/renderer-spreadsheet
@file-viewer/renderer-word
@file-viewer/renderer-presentation
@file-viewer/renderer-data
@file-viewer/renderer-geo
```

关键配置：

- `rendererMode: 'replace'`、`autoRenderers: false`：只启用显式装配的 renderer
- `styleIsolation: 'shadow'`：隔离预览内容样式
- 表格预览固定亮色主题，避免暗色模式下文件内嵌样式不可读；其他 File Viewer 面板跟随应用主题
- `spreadsheet.worker: 'auto'`，CSV 编码自动识别 UTF-8、GBK 与 GB18030，支持列宽/行高拖拽
- Word 使用 Worker 与视觉分页；OFD 使用本地 XML / ZIP 解析链路
- Archive 使用本地 Worker + WASM，支持目录搜索、加密包密码输入、内部文件按需解压与嵌套预览
- Email 本地解析 EML / MSG / MBOX，HTML 正文放入无权限 sandbox iframe
- Mermaid 使用 strict 安全级别并清理 SVG；draw.io 使用离线 SVG 渲染；Excalidraw 使用 roughjs；PlantUML 默认展示源码，需要成图时配置内网 `plantumlServerUrl`
- Geo 默认 `basemap: 'offline'`，不请求外部瓦片；需要底图时配置内网瓦片服务
- 工具栏保留缩放、搜索、打印，关闭重复的下载和主题切换入口

弹窗宽度：Word/OFD 为 `min(960px, 92vw)`；Excel/CSV/PowerPoint/Archive/Email/XMind/图形/数据资产/地理数据为 `min(1200px, 94vw)`；高度均为 90vh。

---

## 图片解码层（HEIC / HEIF / TIFF）

`packages/web/src/utils/image-decode.ts` 在创建 Object URL 前将浏览器无法直接解码的 HEIC / HEIF / TIFF 转成 PNG：

| 格式 | 解码器 | 说明 |
| --- | --- | --- |
| `.heic` / `.heif` | `heic2any` | 动态 import，内部使用 Worker |
| `.tiff` / `.tif` | `utif2` + canvas | `decode` → `decodeImage` → `toRGBA8` → `putImageData` → `toBlob('image/png')` |

```ts
import { createDisplayableImageUrl } from '@/utils/image-decode';

const blob = await fetchManagedFileBlob(file.url);
const url = await createDisplayableImageUrl(blob, file.mimeType, file.originalName);
```

接入点包括 `hooks/useFilePreview.ts`、`pages/system/file-manager/hooks/useFsPreview.ts`、`pages/chat/hooks/useImagePreview.ts`。新增图片图集入口时也应调用 `createDisplayableImageUrl`。

---

## 工具函数

`packages/web/src/utils/file-utils.tsx` 提供：

```ts
canPreviewFile(mimeType, fileName?): boolean
isSpreadsheetFile(mimeType?): boolean
isWordFile(mimeType?): boolean
isPresentationFile(mimeType?): boolean
isOfdFile(mimeType?): boolean
isEmailFile(mimeType?): boolean
isMindMapFile(mimeType?): boolean
isDrawingFile(mimeType?): boolean
isDataAssetFile(mimeType?): boolean
isGeoFile(mimeType?): boolean
isMarkdownFile(mimeType?): boolean
isPlainTextFile(mimeType?): boolean
isJsonFile(mimeType?): boolean
isSvgFile(mimeType?): boolean
isCodeFile(mimeType?): boolean
isArchiveFile(mimeType?): boolean
isZipFile(mimeType?): boolean
isGalleryImageFile(mimeType?, fileName?): boolean
getFileTypeIcon(mimeType?, iconSize?, fileName?): ReactNode
guessMimeTypeFromName(name): string | null
resolveFileMimeType(mimeType, fileName?): string | null
fetchManagedFileBlob(url): Promise<Blob>
extractManagedFileId(url): string | null
fetchProtectedFile(url): Promise<Blob>
```

`packages/web/src/utils/image-decode.ts` 提供：

```ts
needsImageTranscode(mimeType?, fileName?): boolean
toDisplayableImageBlob(blob, mimeType?, fileName?): Promise<Blob>
createDisplayableImageUrl(blob, mimeType?, fileName?): Promise<string>
```

---

## 已接入的页面

| 页面 | 接入方式 | 文件来源 |
| --- | --- | --- |
| 文件管理 `pages/system/files/FilesPage.tsx` | `useFilePreview` + `FilePreviewLayer` | 托管文件 URL |
| 存储浏览 `pages/system/file-configs/StorageFileBrowser.tsx` | `useFilePreview` + `FilePreviewLayer` | 托管文件 URL |
| 文件附件 `components/FileAttachment/index.tsx` | 直接渲染 `FilePreviewModal` | 附件 URL |
| 会话中心 `pages/chat/ChatPage.tsx` | 直接渲染 `FilePreviewModal` | 消息附件 URL |
| 服务器文件管理器 `pages/system/file-manager/FileManagerPage.tsx` | 直接渲染 `FilePreviewModal` | 宿主机文件下载 URL |

## 新页面接入

托管文件列表优先使用 `useFilePreview` + `FilePreviewLayer`。其他简单场景只需保存 `url / name / mimeType`，用 `canPreviewFile(mimeType, fileName)` 控制预览入口，并渲染 `FilePreviewModal`。普通图片由调用方处理 `onFallback` / 图集展示，或直接使用组合方案。
