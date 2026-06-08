import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Modal, Spin, Toast, AudioPlayer, VideoPlayer } from '@douyinfe/semi-ui';
import { useThemeController } from '@/providers/theme-controller';
import { fetchProtectedFile, isSpreadsheetFile } from '@/utils/file-utils';
import { PDFPreviewPanel } from '@/pages/ai/chat/PDFPreviewPanel';
import { request } from '@/utils/request';
import type { IWorkbookData } from '@univerjs/presets';
import type { CSSProperties } from 'react';

// Univer 体积较大，懒加载，避免进入文件管理页即拉取
const ExcelPreviewPanel = lazy(() => import('@/components/ExcelPreviewPanel'));

interface FilePreviewModalProps {
  fileUrl: string;
  /** 表格预览需要文件 ID 调用 /sheet-preview 接口 */
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
  const { isDark } = useThemeController();
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
  }, [audioUrl, videoUrl]);

  useEffect(() => {
    if (!visible) {
      cleanup();
      setPdfFile(null);
      setAudioUrl(null);
      setVideoUrl(null);
      setSheetData(null);
      return;
    }

    if (!mimeType) {
      onClose();
      return;
    }

    const isImage = mimeType.startsWith('image/');
    const isPdf = mimeType === 'application/pdf';
    const isAudio = mimeType.startsWith('audio/');
    const isVideo = mimeType.startsWith('video/');
    const isSpreadsheet = isSpreadsheetFile(mimeType, fileName);

    if (!isImage && !isPdf && !isAudio && !isVideo && !isSpreadsheet) {
      onFallback?.(fileUrl, fileName, mimeType);
      onClose();
      return;
    }

    if (isImage) {
      // 图片不在这个组件中预览，由调用方自行处理 ImagePreview
      onClose();
      return;
    }

    setLoading(true);
    abortRef.current = new AbortController();

    (async () => {
      try {
        if (isSpreadsheet) {
          if (!fileId) throw new Error('缺少文件 ID，无法预览表格');
          const res = await request.get<IWorkbookData>(`/api/files/${fileId}/sheet-preview`, { silent: true });
          if (res.code !== 0 || !res.data) throw new Error(res.message || '表格预览加载失败');
          setSheetData(res.data);
          return;
        }
        const blob = await fetchProtectedFile(fileUrl);
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

  if (!visible) return null;

  if (loading) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        closable={false}
        keepDOM={false}
        bodyStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}
      >
        <Spin size="large" tip="加载中..." />
      </Modal>
    );
  }

  if (pdfFile) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        width="min(1100px, 92vw)"
        style={{ top: '4vh' }}
        bodyStyle={{ padding: 0, height: '88vh', display: 'flex', overflow: 'hidden' }}
        closable={false}
        keepDOM={false}
      >
        <PDFPreviewPanel
          file={pdfFile}
          onClose={handleClose}
          style={{ width: '100%', borderLeft: 'none' }}
        />
      </Modal>
    );
  }

  if (sheetData) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        width="min(1200px, 94vw)"
        style={{ top: '3vh' }}
        bodyStyle={{ padding: 0, height: '90vh', display: 'flex', overflow: 'hidden' }}
        closable={false}
        keepDOM={false}
      >
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
              <Spin size="large" tip="加载预览组件..." />
            </div>
          }
        >
          <ExcelPreviewPanel data={sheetData} fileName={fileName} onClose={handleClose} />
        </Suspense>
      </Modal>
    );
  }

  if (audioUrl) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        width={600}
        style={{ top: '25vh' }}
        bodyStyle={{ padding: 0, overflow: 'hidden', borderRadius: 8 }}
        closable={false}
        keepDOM={false}
      >
        <AudioPlayer
          audioUrl={{ src: audioUrl, title: fileName }}
          theme={isDark ? 'dark' : 'light'}
          style={{ borderRadius: 8 }}
        />
      </Modal>
    );
  }

  if (videoUrl) {
    return (
      <Modal
        visible
        onCancel={handleClose}
        title={null}
        footer={null}
        width="min(960px, 92vw)"
        style={{ top: '4vh' }}
        bodyStyle={{ padding: 0, overflow: 'hidden', borderRadius: 8 }}
        closable={false}
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
      </Modal>
    );
  }

  return null;
}
