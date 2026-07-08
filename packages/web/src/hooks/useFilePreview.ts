import { useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { ManagedFile } from '@zenith/shared';
import { canPreviewFile, fetchProtectedFile } from '@/utils/file-utils';

interface FilePreviewTarget {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

/**
 * 受保护文件的预览/下载共享逻辑（文件管理页与存储空间浏览器共用）。
 *
 * - 图片：进入图集预览（先加载点击图，其余后台渐进加载，会话号防止过期加载写入）
 * - 可预览的非图片（PDF 等）：打开 FilePreviewModal
 * - 其他类型：拉取 blob 后新窗口打开
 *
 * 与 `<FilePreviewLayer preview={...} />` 配套使用。
 *
 * @param getImageFiles 返回当前列表中的图片文件（点击图片时构建图集用）
 */
export function useFilePreview(getImageFiles: () => ManagedFile[]) {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewTarget | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<string | null>(null);
  // previewBlobUrlsRef: 与图片列表索引对齐，记录已创建的 blob URL 便于统一释放
  const previewBlobUrlsRef = useRef<string[]>([]);
  // previewSessionRef: 每次新预览会话自增，用于取消过期的后台加载
  const previewSessionRef = useRef(0);

  const cleanupPreviewBlobs = () => {
    previewBlobUrlsRef.current.forEach((url) => globalThis.URL.revokeObjectURL(url));
    previewBlobUrlsRef.current = [];
  };

  const handlePreview = async (file: ManagedFile) => {
    const isImage = file.mimeType?.startsWith('image/');
    const isPreviewable = canPreviewFile(file.mimeType);

    if (!isPreviewable && !isImage) {
      try {
        const blob = await fetchProtectedFile(file.url);
        const objectUrl = globalThis.URL.createObjectURL(blob);
        globalThis.open(objectUrl, '_blank', 'noopener,noreferrer');
        globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '预览文件失败');
      }
      return;
    }

    if (!isImage) {
      setPreviewLoadingId(file.id);
      try {
        setFilePreview({
          id: file.id,
          url: file.url,
          name: file.originalName,
          mimeType: file.mimeType ?? 'application/octet-stream',
        });
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '预览文件失败');
      } finally {
        setPreviewLoadingId(null);
      }
      return;
    }

    const imageFiles = getImageFiles().filter((f) => f.mimeType?.startsWith('image/'));
    const clickedIndex = imageFiles.findIndex((f) => f.id === file.id);

    setPreviewLoadingId(file.id);
    // 开启新预览会话
    previewSessionRef.current += 1;
    const mySession = previewSessionRef.current;
    try {
      cleanupPreviewBlobs();
      // 先用空占位初始化，保证数组索引稳定
      const initialUrls = imageFiles.map(() => '');
      previewBlobUrlsRef.current = [...initialUrls];

      // 优先加载被点击的图片 → 立即展示预览
      const clickedBlob = await fetchProtectedFile(imageFiles[clickedIndex].url);
      if (previewSessionRef.current !== mySession) return; // 用户在加载完成前已关闭预览
      const clickedUrl = globalThis.URL.createObjectURL(clickedBlob);
      initialUrls[clickedIndex] = clickedUrl;
      previewBlobUrlsRef.current[clickedIndex] = clickedUrl;

      setPreviewSrcList([...initialUrls]);
      setPreviewCurrentIndex(Math.max(0, clickedIndex));
      setPreviewVisible(true);

      // 其余图片后台渐进加载（不阻塞）
      imageFiles.forEach(async (imgFile, i) => {
        if (i === clickedIndex) return;
        try {
          const blob = await fetchProtectedFile(imgFile.url);
          if (previewSessionRef.current !== mySession) return;
          const url = globalThis.URL.createObjectURL(blob);
          previewBlobUrlsRef.current[i] = url;
          setPreviewSrcList((prev) => {
            const updated = [...prev];
            updated[i] = url;
            return updated;
          });
        } catch { /* 忽略单张失败 */ }
      });
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '预览图片失败');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleDownload = async (file: ManagedFile) => {
    setDownloadLoadingId(file.id);
    try {
      const blob = await fetchProtectedFile(file.url);
      const objectUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.originalName;
      link.click();
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '下载文件失败');
    } finally {
      setDownloadLoadingId(null);
    }
  };

  /** 关闭图集预览：使在途后台加载失效并释放 blob URL */
  const closeImagePreview = () => {
    previewSessionRef.current += 1;
    setPreviewVisible(false);
    cleanupPreviewBlobs();
    setPreviewSrcList([]);
  };

  const closeFilePreview = () => setFilePreview(null);

  /** 数据源切换时强制关闭预览（不清空图集列表，与原行为一致） */
  const resetPreview = () => {
    setFilePreview(null);
    setPreviewVisible(false);
    previewSessionRef.current += 1;
  };

  return {
    previewVisible,
    previewSrcList,
    previewCurrentIndex,
    setPreviewCurrentIndex,
    previewLoadingId,
    downloadLoadingId,
    filePreview,
    handlePreview,
    handleDownload,
    closeImagePreview,
    closeFilePreview,
    resetPreview,
  };
}

export type FilePreviewController = ReturnType<typeof useFilePreview>;
