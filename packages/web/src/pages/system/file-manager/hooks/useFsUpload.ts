/**
 * 上传：工具栏文件选择 / 文件夹上传（按 webkitRelativePath 重建目录树）/
 * 拖拽上传 / 右键「上传到此目录」四条途径共用，带逐文件进度。
 */
import React, { useCallback, useRef, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useLocalFileUpload, useTerminalFileOperation } from '@/hooks/queries/terminal-files';
import { joinPath, updateUploadPct } from '../fs-utils';

export function useFsUpload(currentPath: string) {
  const [uploading, setUploading] = useState<{ name: string; progress: number }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  // 右键「上传到此目录」的目标目录（点击隐藏 input 前设置）
  const ctxUploadDirRef = useRef('');
  const ctxUploadInputRef = useRef<HTMLInputElement>(null);
  const dirUploadInputRef = useRef<HTMLInputElement>(null);

  const uploadTerminalFileMutation = useLocalFileUpload();
  const fileOperationMutation = useTerminalFileOperation();

  /** 上传一组文件到指定目录（工具栏选择 / 右键菜单 / 拖拽共用） */
  const uploadFiles = useCallback((files: File[], dir: string) => {
    if (!files.length || !dir) return;
    setUploading(files.map((f) => ({ name: f.name, progress: 0 })));
    const makeProgressHandler = (i: number) => (pct: number) => setUploading((prev) => updateUploadPct(prev, i, pct));
    void Promise.allSettled(
      files.map((f, i) => {
        const formData = new FormData();
        formData.append('path', dir);
        formData.append('file', f);
        return uploadTerminalFileMutation.mutateAsync({ formData, onProgress: makeProgressHandler(i) });
      }),
    ).then((results) => {
      const success = results.filter((r) => r.status === 'fulfilled').length;
      if (success === files.length) Toast.success(`已上传 ${success} 个文件`);
      else Toast.warning(`已上传 ${success}/${files.length} 个文件，${files.length - success} 个失败`);
      setUploading([]);
    });
  }, [uploadTerminalFileMutation]);

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    uploadFiles(files, ctxUploadDirRef.current || currentPath);
    e.target.value = '';
  };

  /** 上传整个文件夹：按 webkitRelativePath 先建目录树，再逐文件上传到对应子目录 */
  const handleDirUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || !currentPath) return;
    const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    // 收集所有需要创建的相对目录（含中间层级），按深度升序创建
    const dirSet = new Set<string>();
    for (const f of files) {
      const parts = rel(f).split('/');
      for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
    }
    const dirs = [...dirSet].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const d of dirs) {
      const abs = d.split('/').reduce((acc, seg) => joinPath(acc, seg), currentPath);
      // 目录已存在时后端返回 400，静默忽略
      await fileOperationMutation
        .mutateAsync({ kind: 'create', path: abs, type: 'dir' })
        .catch(() => {});
    }
    setUploading(files.map((f) => ({ name: rel(f), progress: 0 })));
    const makeProgressHandler = (i: number) => (pct: number) => setUploading((prev) => updateUploadPct(prev, i, pct));
    const results = await Promise.allSettled(
      files.map((f, i) => {
        const relDir = rel(f).split('/').slice(0, -1);
        const destDir = relDir.reduce((acc, seg) => joinPath(acc, seg), currentPath);
        const formData = new FormData();
        formData.append('path', destDir);
        formData.append('file', f);
        return uploadTerminalFileMutation.mutateAsync({ formData, onProgress: makeProgressHandler(i) });
      }),
    );
    const success = results.filter((r) => r.status === 'fulfilled').length;
    if (success === files.length) Toast.success(`已上传文件夹（${success} 个文件）`);
    else Toast.warning(`已上传 ${success}/${files.length} 个文件，${files.length - success} 个失败`);
    setUploading([]);
  };

  // ── 拖拽上传（从桌面拖入内容区） ──────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    uploadFiles(files, currentPath);
  }, [uploadFiles, currentPath]);

  /** 打开文件选择器，上传到指定目录（默认当前目录） */
  const openUploadPicker = (dir?: string) => {
    ctxUploadDirRef.current = dir ?? currentPath;
    ctxUploadInputRef.current?.click();
  };

  const openDirUploadPicker = () => dirUploadInputRef.current?.click();

  return {
    uploading,
    dragOver,
    ctxUploadInputRef,
    dirUploadInputRef,
    handleUploadChange,
    handleDirUploadChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    openUploadPicker,
    openDirUploadPicker,
  };
}
