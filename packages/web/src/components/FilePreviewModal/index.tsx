import { useState, useEffect, useCallback, lazy, Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal, Spin, Toast, AudioPlayer, VideoPlayer, Typography } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import { fileContract } from '@zenith/shared/platform';
import { contractKey } from '@/lib/contract-query';
import { useThemeController } from '@/providers/theme-controller';
import { fetchManagedFileBlob, resolveFileMimeType, isSpreadsheetFile, isWordFile, isPresentationFile, isOfdFile, isEmailFile, isMindMapFile, isDrawingFile, isDataAssetFile, isGeoFile, isMarkdownFile, isPlainTextFile, isArchiveFile, isJsonFile, isSvgFile, isCodeFile, getFileTypeIcon } from '@/utils/file-utils';
import AppModal from '@/components/AppModal';
import type { CSSProperties, ReactNode } from 'react';
import './filePreview.css';

// @embedpdf 引擎 ~1MB，懒加载，避免经 FileAttachment 链进入首屏
const PDFPreviewPanel = lazy(() =>
  import('@/components/PDFPreviewPanel').then((m) => ({ default: m.PDFPreviewPanel })),
);
// File Viewer 重型渲染器懒加载，避免影响首屏
const FileViewerPreviewPanel = lazy(() => import('@/components/FileViewerPreviewPanel'));
// react-markdown 懒加载
const MarkdownPreviewPanel = lazy(() => import('@/components/MarkdownPreviewPanel'));
// Semi JsonViewer 懒加载
const JsonPreviewPanel = lazy(() => import('@/components/JsonPreviewPanel'));
// Monaco Editor 懒加载（代码/纯文本文件预览）
const MonacoPreviewPanel = lazy(() => import('@/components/MonacoPreviewPanel'));

interface FilePreviewModalProps {
  fileUrl: string;
  fileName?: string;
  mimeType?: string | null;
  visible: boolean;
  onClose: () => void;
  /** 遇到不支持预览的格式时触发，不传则组件内部静默关闭 */
  onFallback?: (fileUrl: string, fileName: string, mimeType: string) => void;
  style?: CSSProperties;
}

type PreviewKind = 'spreadsheet' | 'word' | 'presentation' | 'ofd' | 'email' | 'mindmap' | 'drawing' | 'dataAsset' | 'geo' | 'archive' | 'markdown' | 'plainText' | 'json' | 'svg' | 'code' | 'pdf' | 'audio' | 'video';

type PreviewData =
  | { kind: 'spreadsheet' | 'word' | 'presentation' | 'ofd' | 'email' | 'mindmap' | 'drawing' | 'dataAsset' | 'geo' | 'archive'; file: File }
  | { kind: 'markdown'; text: string }
  | { kind: 'plainText'; text: string }
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

/** 懒加载预览面板的统一弹窗外壳：AppModal + Suspense 加载兜底（各分支仅宽高不同） */
function PreviewModalShell({ title, onCancel, fullscreen, onToggleFullscreen, width, viewportHeight, children }: Readonly<{
  title: ReactNode;
  onCancel: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  width: string;
  /** 非全屏时弹窗高度基准（如 '90vh'） */
  viewportHeight: string;
  children: ReactNode;
}>) {
  return (
    <AppModal
      visible
      onCancel={onCancel}
      title={title}
      footer={null}
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
      width={width}
      centered
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: fullscreen ? 'calc(100vh - 40px)' : `calc(${viewportHeight} - 40px)` }}
      keepDOM={false}
    >
      <Suspense
        fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <Spin size="large" tip="加载预览组件..." />
          </div>
        }
      >
        {children}
      </Suspense>
    </AppModal>
  );
}

export default function FilePreviewModal({
  fileUrl,
  fileName = '文件',
  mimeType,
  visible,
  onClose,
  onFallback,
}: Readonly<FilePreviewModalProps>) {
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    setFullscreen(f => !f);
  }, []);
  const { isDark } = useThemeController();
  const resolvedMimeType = useMemo(
    () => resolveFileMimeType(mimeType, fileName),
    [fileName, mimeType],
  );

  const previewKind = useMemo<PreviewKind | 'unsupported' | 'image' | null>(() => {
    if (!resolvedMimeType) return null;
    const isImage = resolvedMimeType.startsWith('image/');
    const tsExtPattern = /\.(ts|tsx)$/i;
    const isMpegTsAsCode = resolvedMimeType === 'video/mp2t' && tsExtPattern.test(fileName);
    if (isSpreadsheetFile(resolvedMimeType)) return 'spreadsheet';
    if (isWordFile(resolvedMimeType)) return 'word';
    if (isPresentationFile(resolvedMimeType)) return 'presentation';
    if (isOfdFile(resolvedMimeType)) return 'ofd';
    if (isEmailFile(resolvedMimeType)) return 'email';
    if (isMindMapFile(resolvedMimeType)) return 'mindmap';
    if (isDrawingFile(resolvedMimeType)) return 'drawing';
    // 必须早于下方的 image/* 判定：PSD 的规范 MIME 是 image/vnd.adobe.photoshop
    if (isDataAssetFile(resolvedMimeType)) return 'dataAsset';
    if (isGeoFile(resolvedMimeType)) return 'geo';
    if (isMarkdownFile(resolvedMimeType)) return 'markdown';
    if (isPlainTextFile(resolvedMimeType)) return 'plainText';
    if (isArchiveFile(resolvedMimeType)) return 'archive';
    if (isJsonFile(resolvedMimeType)) return 'json';
    if (isSvgFile(resolvedMimeType)) return 'svg';
    if (isCodeFile(resolvedMimeType) || isMpegTsAsCode) return 'code';
    if (resolvedMimeType === 'application/pdf') return 'pdf';
    if (resolvedMimeType.startsWith('audio/')) return 'audio';
    if (resolvedMimeType.startsWith('video/') && !isMpegTsAsCode) return 'video';
    if (isImage) return 'image';
    return 'unsupported';
  }, [fileName, resolvedMimeType]);

  // 非契约 blob 通道（任意文件地址经 fetchManagedFileBlob 取二进制并按类型加工），保留手写 useQuery，key 取文件内容契约 key 追加预览段
  const previewQuery = useQuery({
    queryKey: [...contractKey(fileContract.content), 'preview', visible, fileUrl, fileName, resolvedMimeType, previewKind],
    queryFn: async (): Promise<PreviewData> => {
      const blob = await fetchManagedFileBlob(fileUrl);
      if (previewKind === 'spreadsheet' || previewKind === 'word' || previewKind === 'presentation' || previewKind === 'ofd' || previewKind === 'email' || previewKind === 'mindmap' || previewKind === 'drawing' || previewKind === 'dataAsset' || previewKind === 'geo' || previewKind === 'archive') {
        return {
          kind: previewKind,
          file: new File([blob], fileName, { type: resolvedMimeType || blob.type }),
        };
      }
      if (previewKind === 'markdown') return { kind: 'markdown', text: await blob.text() };
      if (previewKind === 'plainText') return { kind: 'plainText', text: await blob.text() };
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
      return;
    }
    if (!resolvedMimeType) {
      onClose();
      return;
    }
    if (previewKind === 'unsupported') {
      onFallback?.(fileUrl, fileName, resolvedMimeType);
      onClose();
      return;
    }
    if (previewKind === 'image') {
      onClose();
    }
  }, [fileName, fileUrl, onClose, onFallback, previewKind, resolvedMimeType, visible]);

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
      {getFileTypeIcon(mimeType, 15, fileName)}
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
        centered
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
        centered
        bodyStyle={{ padding: 0, display: 'flex', overflow: 'hidden', height: fullscreen ? '100vh' : '88vh' }}
        closable={false}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
              <Spin size="large" />
            </div>
          }
        >
          <PDFPreviewPanel
            file={previewData.file}
            onClose={handleClose}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            style={{ width: '100%', borderLeft: 'none' }}
          />
        </Suspense>
      </Modal>
    );
  }

  if (previewData?.kind === 'spreadsheet' || previewData?.kind === 'word' || previewData?.kind === 'presentation' || previewData?.kind === 'ofd' || previewData?.kind === 'email' || previewData?.kind === 'mindmap' || previewData?.kind === 'drawing' || previewData?.kind === 'dataAsset' || previewData?.kind === 'geo' || previewData?.kind === 'archive') {
    const isPresentation = previewData.kind === 'presentation';
    const isWide = previewData.kind === 'spreadsheet' || previewData.kind === 'archive' || previewData.kind === 'email' || previewData.kind === 'mindmap' || previewData.kind === 'drawing' || previewData.kind === 'dataAsset' || previewData.kind === 'geo' || isPresentation;
    return (
      <PreviewModalShell title={previewTitle} onCancel={handleClose} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen}
        width={isWide ? 'min(1200px, 94vw)' : 'min(960px, 92vw)'} viewportHeight="90vh">
        <FileViewerPreviewPanel file={previewData.file} style={{ flex: 1 }} />
      </PreviewModalShell>
    );
  }

  if (previewData?.kind === 'markdown') {
    const isRawText = previewData.text.startsWith('\u0000PLAINTEXT\u0000');
    const displayContent = isRawText ? previewData.text.slice('\u0000PLAINTEXT\u0000'.length) : previewData.text;
    return (
      <PreviewModalShell title={previewTitle} onCancel={handleClose} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen}
        width="min(900px, 92vw)" viewportHeight="90vh">
        <MarkdownPreviewPanel
          content={displayContent}
          rawText={isRawText}
          style={{ flex: 1, minHeight: 0 }}
        />
      </PreviewModalShell>
    );
  }

  if (previewData?.kind === 'json') {
    return (
      <PreviewModalShell title={previewTitle} onCancel={handleClose} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen}
        width="min(900px, 92vw)" viewportHeight="88vh">
        <JsonPreviewPanel content={previewData.text} style={{ flex: 1, minHeight: 0 }} />
      </PreviewModalShell>
    );
  }

  if (previewData?.kind === 'code' || previewData?.kind === 'plainText') {
    return (
      <PreviewModalShell title={previewTitle} onCancel={handleClose} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen}
        width="min(1100px, 92vw)" viewportHeight="90vh">
        <MonacoPreviewPanel
          content={previewData.text}
          fileName={fileName}
          style={{ flex: 1, minHeight: 0 }}
        />
      </PreviewModalShell>
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
        centered
        bodyStyle={{
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          height: fullscreen ? 'calc(100vh - 40px)' : 'calc(80vh - 40px)',
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
        centered
        bodyStyle={{ padding: 0, overflow: 'hidden', borderRadius: 'var(--semi-border-radius-medium)' }}
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
          style={{ borderRadius: 'var(--semi-border-radius-medium)' }}
        />
      </AppModal>
    );
  }

  return null;
}
