/**
 * 预览：图片画廊（blob URL 懒加载 + 会话令牌防串扰）与通用文件预览
 * （PDF/音视频/Office 等交给 FilePreviewModal）。
 *
 * 画廊图片走带 Authorization 的 fetch 取 blob（受保护端点无法用 <img src> 直连），
 * blob URL 生命周期由本 hook 统一管理：关闭画廊 / 开启新画廊时批量 revoke。
 */
import { useCallback, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { NON_SVG_IMAGE_EXTS, getFileMimeType } from '../fs-utils';
import { createDisplayableImageUrl } from '@/utils/image-decode';
import type { FsEntry } from '../types';
import { request } from '@/utils/request';
import { terminalFileDownloadUrl } from '@/hooks/queries/terminal-files';

export function useFsPreview(filteredEntries: FsEntry[]) {
  // 通用文件预览（FilePreviewModal）
  const [preview, setPreview] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  // 图片画廊预览
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const previewEntriesRef = useRef<FsEntry[]>([]);
  const previewSessionRef = useRef(0);

  const cleanupPreviewBlobs = () => {
    previewBlobUrlsRef.current.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    previewBlobUrlsRef.current = [];
  };

  /** 按需加载第 idx 张预览图（懒加载，已加载则跳过） */
  const loadPreviewImage = useCallback(async (idx: number, session: number) => {
    const entries = previewEntriesRef.current;
    if (idx < 0 || idx >= entries.length) return;
    if (previewBlobUrlsRef.current[idx]) return;
    previewBlobUrlsRef.current[idx] = 'loading';
    try {
      const blob = await request.getBlob(terminalFileDownloadUrl(entries[idx].path));
      if (previewSessionRef.current !== session) return;
      if (!blob) throw new Error('预览加载失败');
      if (previewSessionRef.current !== session) return;
      const url = await createDisplayableImageUrl(blob, null, entries[idx].name);
      if (previewSessionRef.current !== session) {
        URL.revokeObjectURL(url);
        return;
      }
      previewBlobUrlsRef.current[idx] = url;
      setPreviewSrcList((prev) => { const u = [...prev]; u[idx] = url; return u; });
    } catch {
      if (previewSessionRef.current === session) previewBlobUrlsRef.current[idx] = '';
    }
  }, []);

  /** 加载当前及相邻 ±2 张（翻页时按需补载） */
  const loadAroundPreview = useCallback((idx: number) => {
    const session = previewSessionRef.current;
    for (const i of [idx, idx + 1, idx - 1, idx + 2, idx - 2]) void loadPreviewImage(i, session);
  }, [loadPreviewImage]);

  const handlePreview = useCallback(async (entry: FsEntry) => {
    if (entry.type === 'dir') return;
    const ext = (entry.name.split('.').pop() ?? '').toLowerCase();
    if (NON_SVG_IMAGE_EXTS.has(ext)) {
      const imageEntries = filteredEntries.filter(
        (e) => e.type !== 'dir' && NON_SVG_IMAGE_EXTS.has((e.name.split('.').pop() ?? '').toLowerCase()),
      );
      const clickedIndex = Math.max(0, imageEntries.findIndex((e) => e.path === entry.path));
      previewSessionRef.current += 1;
      const mySession = previewSessionRef.current;
      cleanupPreviewBlobs();
      previewEntriesRef.current = imageEntries;
      previewBlobUrlsRef.current = imageEntries.map(() => '');
      setPreviewSrcList(imageEntries.map(() => ''));
      // 优先等点击项加载完成再打开，避免空白闪烁
      await loadPreviewImage(clickedIndex, mySession);
      if (previewSessionRef.current !== mySession) return;
      if (!previewBlobUrlsRef.current[clickedIndex]) { Toast.error('图片加载失败'); return; }
      setPreviewCurrentIndex(clickedIndex);
      setPreviewVisible(true);
      loadAroundPreview(clickedIndex);
    } else {
      const mimeType = getFileMimeType(entry.name);
      if (mimeType) {
        setPreview({ url: terminalFileDownloadUrl(entry.path), name: entry.name, mimeType });
      } else {
        Toast.warning('该文件不支持预览，请下载后查看');
      }
    }
  }, [filteredEntries, loadPreviewImage, loadAroundPreview]);

  /** 画廊翻页：更新索引并预载相邻图片 */
  const handleGalleryChange = (i: number) => {
    setPreviewCurrentIndex(i);
    loadAroundPreview(i);
  };

  /** 关闭画廊：递增会话令牌使 in-flight 加载失效，回收全部 blob URL */
  const closeGallery = () => {
    previewSessionRef.current += 1;
    setPreviewVisible(false);
    cleanupPreviewBlobs();
    setPreviewSrcList([]);
  };

  return {
    preview,
    setPreview,
    previewVisible,
    previewSrcList,
    previewCurrentIndex,
    handlePreview,
    handleGalleryChange,
    closeGallery,
  };
}
