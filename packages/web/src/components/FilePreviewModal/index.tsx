import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Modal, Spin, Toast, AudioPlayer, VideoPlayer, Typography } from '@douyinfe/semi-ui';
import { useThemeController } from '@/providers/theme-controller';
import { fetchProtectedFile, isSpreadsheetFile, isWordFile, isMarkdownFile, isPlainTextFile, isZipFile, isJsonFile, isSvgFile, isCodeFile, getFileTypeIcon } from '@/utils/file-utils';
import { PDFPreviewPanel } from '@/pages/ai/chat/PDFPreviewPanel';
import { request } from '@/utils/request';
import AppModal from '@/components/AppModal';
import type { IWorkbookData } from '@univerjs/presets';
import type { CSSProperties, ReactNode } from 'react';

// Univer 体积较大，懒加载，避免进入文件管理页即拉取
const ExcelPreviewPanel = lazy(() => import('@/components/ExcelPreviewPanel'));
// docx-preview 懒加载，避免影响首屏
const DocxPreviewPanel = lazy(() => import('@/components/DocxPreviewPanel'));
// react-markdown 懒加载
const MarkdownPreviewPanel = lazy(() => import('@/components/MarkdownPreviewPanel'));
// jszip + Semi Tree 懒加载
const ZipPreviewPanel = lazy(() => import('@/components/ZipPreviewPanel'));
// Semi JsonViewer 懒加载
const JsonPreviewPanel = lazy(() => import('@/components/JsonPreviewPanel'));
// Monaco Editor 懒加载（代码/纯文本文件预览）
const MonacoPreviewPanel = lazy(() => import('@/components/MonacoPreviewPanel'));

interface FilePreviewModalProps {
  fileUrl: string;
  /** 文件 ID。预览 Excel 表格时必须传入，其他类型可不传 */
  fileId?: number;
  fileName?: string;
  mimeType?: string | null;
  visible: boolean;
  onClose: () => void;
  /** 遇到不支持预览的格式时触发，不传则组件内部静默关闭 */
  onFallback?: (fileUrl: string, fileName: string, mimeType: string) => void;
  style?: CSSProperties;
}

export default function FilePreviewModal({
  fileUrl,
  fileId,
  fileName = '文件',
  mimeType,
  visible,
  onClose,
  onFallback,
}: Readonly<FilePreviewModalProps>) {
  const [loading, setLoading] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sheetData, setSheetData] = useState<IWorkbookData | null>(null);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [markdownText, setMarkdownText] = useState<string | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // sheetKey 用于全屏切换时重建 Univer，sheetTransitioning 显示过渡 spinner
  const [sheetKey, setSheetKey] = useState(0);
  const [sheetTransitioning, setSheetTransitioning] = useState(false);
  const toggleFullscreen = useCallback(() => {
    setFullscreen(f => !f);
    setSheetTransitioning(true);
    setTimeout(() => {
      setSheetKey(k => k + 1);
      setSheetTransitioning(false);
    }, 360);
  }, []);
  const { isDark } = useThemeController();
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioUrl) { URL.revokeObjectURL(audioUrl); }
    if (videoUrl) { URL.revokeObjectURL(videoUrl); }
    if (svgUrl) { URL.revokeObjectURL(svgUrl); }
  }, [audioUrl, videoUrl, svgUrl]);

  useEffect(() => {
    if (!visible) {
      cleanup();
      setPdfFile(null);
      setAudioUrl(null);
      setVideoUrl(null);
      setSheetData(null);
      setDocxBlob(null);
      setMarkdownText(null);
      setZipBlob(null);
      setJsonText(null);
      setSvgUrl(null);
      setCodeContent(null);
      setFullscreen(false);
      setSheetKey(0);
      setSheetTransitioning(false);
      return;
    }

    if (!mimeType) {
      onClose();
      return;
    }

    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType === 'application/pdf';
    const isAudio = mimeType.startsWith('audio/');
    // .ts 文件扩展名与 MPEG-2 TS 视频流共用，服务器可能误判为 video/mp2t。
    // 当文件名以 .ts/.tsx 结尾时强制排除出视频分支。
    const tsExtPattern = /\.(ts|tsx)$/i;
    const isMpegTsAsCode = mimeType === 'video/mp2t' && tsExtPattern.test(fileName);
    const isVideo = mimeType.startsWith('video/') && !isMpegTsAsCode;
    const isSpreadsheet = isSpreadsheetFile(mimeType);
    const isWord = isWordFile(mimeType);
    const isMarkdown = isMarkdownFile(mimeType);
    const isPlainText = isPlainTextFile(mimeType);
    const isZip = isZipFile(mimeType);
    const isJson = isJsonFile(mimeType);
    const isSvg = isSvgFile(mimeType);
    const isCode = isCodeFile(mimeType) || isMpegTsAsCode;

    if (!isImage && !isPdf && !isAudio && !isVideo && !isSpreadsheet && !isWord && !isMarkdown && !isPlainText && !isZip && !isJson && !isSvg && !isCode) {
      onFallback?.(fileUrl, fileName, mimeType);
      onClose();
      return;
    }

    if (isImage && !isSvg) {
      // 普通图片不在这个组件中预览，由调用方自行处理 ImagePreview（SVG 归入此分支导公处理）
      onClose();
      return;
    }

    setLoading(true);
    abortRef.current = new AbortController();

    (async () => {
      try {
        if (isSpreadsheet) {
          if (!fileId) throw new Error('预览 Excel 表格需要传入 fileId');
          const res = await request.get<IWorkbookData>(`/api/files/${fileId}/sheet-preview`, { silent: true });
          if (res.code !== 0 || !res.data) throw new Error(res.message || '表格预览加载失败');
          setSheetData(res.data);
          return;
        }
        const blob = await fetchProtectedFile(fileUrl);
        if (isWord) {
          setDocxBlob(blob);
          return;
        }
        if (isMarkdown) {
          const text = await blob.text();
          setMarkdownText(text);
          return;
        }
        if (isPlainText) {
          const text = await blob.text();
          setCodeContent(text);
          return;
        }
        if (isZip) {
          setZipBlob(blob);
          return;
        }
        if (isJson) {
          const text = await blob.text();
          setJsonText(text);
          return;
        }
        if (isSvg) {
          const url = URL.createObjectURL(blob);
          setSvgUrl(url);
          return;
        }
        if (isCode) {
          const text = await blob.text();
          setCodeContent(text);
          return;
        }
        if (isPdf) {
          const file = new File([blob], fileName, { type: 'application/pdf' });
          setPdfFile(file);
        } else if (isAudio) {
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        } else if (isVideo) {
          const url = URL.createObjectURL(blob);
          setVideoUrl(url);
        }
      } catch (e) {
        Toast.error(e instanceof Error ? e.message : '文件加载失败');
        onClose();
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fileUrl, fileId, fileName, mimeType]);

  const handleClose = () => {
    cleanup();
    onClose();
  };

  /**
   * 预览弹窗标题：文件类型图标 + 文件名。
   * 由 AppModal 的 title prop 承载，统一在弹窗顶部展示。
   * PDF 除外（PDFPreviewPanel 有自己的完整标题栏，不使用 AppModal）。
   */
  const previewTitle: ReactNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {getFileTypeIcon(mimeType, 15)}
      <Typography.Text
        ellipsis={{ showTooltip: true }}
        style={{ fontSize: 13, fontWeight: 500, minWidth: 0 }}
      >
        {fileName}
      </Typography.Text>
    </div>
  );

  if (!visible) return null;

  if (loading) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreenable={false}
        keepDOM={false}
        bodyStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}
      >
        <Spin size="large" tip="加载中..." />
      </AppModal>
    );
  }

  if (pdfFile) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        fullScreen={fullscreen}
        width="min(1100px, 92vw)"
        style={{ top: '4vh' }}
        bodyStyle={{ padding: 0, display: 'flex', overflow: 'hidden', height: fullscreen ? '100vh' : '88vh' }}
        closable={false}
        keepDOM={false}
      >
        <PDFPreviewPanel
          file={pdfFile}
          onClose={handleClose}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          style={{ width: '100%', borderLeft: 'none' }}
        />
      </Modal>
    );
  }

  if (sheetData) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(1200px, 94vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(90vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          {sheetTransitioning ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="切换中..." />
            </div>
          ) : (
            <ExcelPreviewPanel key={sheetKey} data={sheetData} style={{ flex: 1, minHeight: 0 }} />
          )}
        </Suspense>
      </AppModal>
    );
  }

  if (docxBlob) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(960px, 92vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(90vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <DocxPreviewPanel blob={docxBlob} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (markdownText !== null) {
    const isRawText = markdownText.startsWith('\u0000PLAINTEXT\u0000');
    const displayContent = isRawText ? markdownText.slice('\u0000PLAINTEXT\u0000'.length) : markdownText;
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(900px, 92vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(90vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <MarkdownPreviewPanel
            content={displayContent}
            rawText={isRawText}
            style={{ flex: 1, minHeight: 0 }}
          />
        </Suspense>
      </AppModal>
    );
  }

  if (zipBlob) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(700px, 92vw)"
        style={{ top: '5vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(85vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <ZipPreviewPanel blob={zipBlob} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (jsonText !== null) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(900px, 92vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(88vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <JsonPreviewPanel content={jsonText} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (codeContent !== null) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(1100px, 92vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(90vh - 40px)' }}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <MonacoPreviewPanel
            content={codeContent}
            fileName={fileName}
            style={{ flex: 1, minHeight: 0 }}
          />
        </Suspense>
      </AppModal>
    );
  }

  if (svgUrl) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        width="min(900px, 92vw)"
        style={{ top: '5vh' }}
        bodyStyle={{
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          height: fullscreen ? 'calc(100vh - 40px)' : 'calc(80vh - 40px)',
          background: 'var(--semi-color-bg-0)',
        }}
        keepDOM={false}
      >
        <img
          src={svgUrl}
          alt={fileName}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </AppModal>
    );
  }

  if (audioUrl) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreenable={false}
        width={600}
        style={{ top: '25vh' }}
        bodyStyle={{ padding: 0, overflow: 'hidden', borderRadius: 8 }}
        keepDOM={false}
      >
        <AudioPlayer
          audioUrl={{ src: audioUrl, title: fileName }}
          theme={isDark ? 'dark' : 'light'}
          style={{ borderRadius: 8 }}
        />
      </AppModal>
    );
  }

  if (videoUrl) {
    return (
      <AppModal
        visible
        onCancel={handleClose}
        title={previewTitle}
        footer={null}
        fullscreenable={false}
        width="min(960px, 92vw)"
        style={{ top: '4vh' }}
        bodyStyle={{ padding: 0, overflow: 'hidden', borderRadius: 8 }}
        keepDOM={false}
      >
        <VideoPlayer
          src={videoUrl}
          theme={isDark ? 'dark' : 'light'}
          width="100%"
          autoPlay={false}
          muted={false}
          volume={100}
          clickToPlay={true}
          defaultPlaybackRate={1}
          playbackRateList={[
            { label: '0.5x', value: 0.5 },
            { label: '1x', value: 1 },
            { label: '1.5x', value: 1.5 },
            { label: '2x', value: 2 },
          ]}
          style={{ borderRadius: 8 }}
        />
      </AppModal>
    );
  }

  return null;
}
