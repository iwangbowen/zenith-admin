import { useState, useEffect, useCallback, lazy, Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal, Spin, Toast, AudioPlayer, VideoPlayer, Typography } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import { useThemeController } from '@/providers/theme-controller';
import { fetchProtectedFile, isSpreadsheetFile, isWordFile, isMarkdownFile, isPlainTextFile, isZipFile, isJsonFile, isSvgFile, isCodeFile, getFileTypeIcon } from '@/utils/file-utils';
import { PDFPreviewPanel } from '@/pages/ai/chat/PDFPreviewPanel';
import { request } from '@/utils/request';
import AppModal from '@/components/AppModal';
import { unwrap } from '@/lib/query';
import type { IWorkbookData } from '@univerjs/presets';
import type { CSSProperties, ReactNode } from 'react';
import './filePreview.css';

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
  fileId?: string;
  fileName?: string;
  mimeType?: string | null;
  visible: boolean;
  onClose: () => void;
  /** 遇到不支持预览的格式时触发，不传则组件内部静默关闭 */
  onFallback?: (fileUrl: string, fileName: string, mimeType: string) => void;
  style?: CSSProperties;
}

type PreviewKind = 'spreadsheet' | 'word' | 'markdown' | 'plainText' | 'zip' | 'json' | 'svg' | 'code' | 'pdf' | 'audio' | 'video';

type PreviewData =
  | { kind: 'spreadsheet'; data: IWorkbookData }
  | { kind: 'word'; blob: Blob }
  | { kind: 'markdown'; text: string }
  | { kind: 'plainText'; text: string }
  | { kind: 'zip'; blob: Blob }
  | { kind: 'json'; text: string }
  | { kind: 'svg'; url: string }
  | { kind: 'code'; text: string }
  | { kind: 'pdf'; file: File }
  | { kind: 'audio'; url: string }
  | { kind: 'video'; url: string };

function revokePreviewUrl(data: PreviewData | undefined) {
  if (data?.kind === 'audio' || data?.kind === 'video' || data?.kind === 'svg') {
    URL.revokeObjectURL(data.url);
  }
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

  const previewKind = useMemo<PreviewKind | 'unsupported' | 'image' | null>(() => {
    if (!mimeType) return null;
    const isImage = mimeType.startsWith('image/');
    const tsExtPattern = /\.(ts|tsx)$/i;
    const isMpegTsAsCode = mimeType === 'video/mp2t' && tsExtPattern.test(fileName);
    if (isSpreadsheetFile(mimeType)) return 'spreadsheet';
    if (isWordFile(mimeType)) return 'word';
    if (isMarkdownFile(mimeType)) return 'markdown';
    if (isPlainTextFile(mimeType)) return 'plainText';
    if (isZipFile(mimeType)) return 'zip';
    if (isJsonFile(mimeType)) return 'json';
    if (isSvgFile(mimeType)) return 'svg';
    if (isCodeFile(mimeType) || isMpegTsAsCode) return 'code';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/') && !isMpegTsAsCode) return 'video';
    if (isImage) return 'image';
    return 'unsupported';
  }, [fileName, mimeType]);

  const previewQuery = useQuery({
    queryKey: ['files', 'preview', visible, fileUrl, fileId ?? null, fileName, mimeType ?? null],
    queryFn: async (): Promise<PreviewData> => {
      if (previewKind === 'spreadsheet') {
        if (!fileId) throw new Error('预览 Excel 表格需要传入 fileId');
        const data = await request.get<IWorkbookData>(`/api/files/${fileId}/sheet-preview`, { silent: true }).then(unwrap);
        return { kind: 'spreadsheet', data };
      }
      const blob = await fetchProtectedFile(fileUrl);
      if (previewKind === 'word') return { kind: 'word', blob };
      if (previewKind === 'markdown') return { kind: 'markdown', text: await blob.text() };
      if (previewKind === 'plainText') return { kind: 'plainText', text: await blob.text() };
      if (previewKind === 'zip') return { kind: 'zip', blob };
      if (previewKind === 'json') return { kind: 'json', text: await blob.text() };
      if (previewKind === 'svg') return { kind: 'svg', url: URL.createObjectURL(blob) };
      if (previewKind === 'code') return { kind: 'code', text: await blob.text() };
      if (previewKind === 'pdf') return { kind: 'pdf', file: new File([blob], fileName, { type: 'application/pdf' }) };
      if (previewKind === 'audio') return { kind: 'audio', url: URL.createObjectURL(blob) };
      if (previewKind === 'video') return { kind: 'video', url: URL.createObjectURL(blob) };
      throw new Error('文件加载失败');
    },
    enabled: visible && !!previewKind && previewKind !== 'unsupported' && previewKind !== 'image',
    staleTime: 0,
    gcTime: 0,
  });
  const previewData = previewQuery.data;

  useEffect(() => {
    return () => revokePreviewUrl(previewData);
  }, [previewData]);

  useEffect(() => {
    if (!visible) {
      setFullscreen(false);
      setSheetKey(0);
      setSheetTransitioning(false);
      return;
    }
    if (!mimeType) {
      onClose();
      return;
    }
    if (previewKind === 'unsupported') {
      onFallback?.(fileUrl, fileName, mimeType);
      onClose();
      return;
    }
    if (previewKind === 'image') {
      onClose();
    }
  }, [fileName, fileUrl, mimeType, onClose, onFallback, previewKind, visible]);

  useEffect(() => {
    if (previewQuery.error) {
      Toast.error(previewQuery.error instanceof Error ? previewQuery.error.message : '文件加载失败');
      onClose();
    }
  }, [onClose, previewQuery.error]);

  const handleClose = () => {
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

  if (previewQuery.isLoading) {
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

  if (previewData?.kind === 'pdf') {
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
          file={previewData.file}
          onClose={handleClose}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          style={{ width: '100%', borderLeft: 'none' }}
        />
      </Modal>
    );
  }

  if (previewData?.kind === 'spreadsheet') {
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
            <ExcelPreviewPanel key={sheetKey} data={previewData.data} style={{ flex: 1, minHeight: 0 }} />
          )}
        </Suspense>
      </AppModal>
    );
  }

  if (previewData?.kind === 'word') {
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
          <DocxPreviewPanel blob={previewData.blob} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (previewData?.kind === 'markdown') {
    const isRawText = previewData.text.startsWith('\u0000PLAINTEXT\u0000');
    const displayContent = isRawText ? previewData.text.slice('\u0000PLAINTEXT\u0000'.length) : previewData.text;
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

  if (previewData?.kind === 'zip') {
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
          <ZipPreviewPanel blob={previewData.blob} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (previewData?.kind === 'json') {
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
          <JsonPreviewPanel content={previewData.text} style={{ flex: 1, minHeight: 0 }} />
        </Suspense>
      </AppModal>
    );
  }

  if (previewData?.kind === 'code' || previewData?.kind === 'plainText') {
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
            content={previewData.text}
            fileName={fileName}
            style={{ flex: 1, minHeight: 0 }}
          />
        </Suspense>
      </AppModal>
    );
  }

  if (previewData?.kind === 'svg') {
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
          src={previewData.url}
          alt={fileName}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </AppModal>
    );
  }

  if (previewData?.kind === 'audio') {
    // 音频固定在页面底部以播放条形式呈现，避免在窄弹窗内控件（播放键）被裁切
    return createPortal(
      <div className="zenith-audio-dock" role="region" aria-label="音频播放器">
        <div className="zenith-audio-dock__inner">
          <div className="zenith-audio-dock__player">
            <AudioPlayer
              className="zenith-audio-preview"
              audioUrl={{ src: previewData.url, title: fileName }}
              theme={isDark ? 'dark' : 'light'}
              autoPlay
              style={{ width: '100%' }}
            />
          </div>
          <button
            type="button"
            className="zenith-audio-dock__close"
            onClick={handleClose}
            aria-label="关闭音频播放器"
          >
            <X size={18} />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (previewData?.kind === 'video') {
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
          src={previewData.url}
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
