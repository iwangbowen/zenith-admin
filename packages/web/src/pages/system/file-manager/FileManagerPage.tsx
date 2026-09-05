/**
 * 服务器文件管理器（/system/file-manager，菜单归属「系统运维」）。
 *
 * 操作对象是**宿主机磁盘上的真实文件系统**：目录浏览、复制/剪切、重命名、压缩解压、
 * chmod、校验和、递归搜索、文本文件在线编辑。数据来自 `terminalFileContract`
 * （`services/ops/terminal-files.service.ts`），DB 中没有任何记录，`FsEntry`
 * 携带的是 permissions / uid / gid 这类 POSIX 元数据。
 *
 * 权限码为 `system:file:use`；Web 终端内部文件树持有 terminal:execute 时仍可复用本机接口。
 * 二期新增 HostSelector：本机维持完整功能，远端 Linux 通过平台主机 SFTP 提供核心文件操作。
 *
 * ⚠️ 勿与 `pages/system/files/FilesPage.tsx` 混淆：那是应用内的**托管文件库**
 * （业务附件），走 `/api/files/*` + 存储抽象层（local/OSS/S3/COS），每个文件在
 * DB 有 `ManagedFile` 记录。两者数据源、后端域、权限码完全不同，没有重叠。
 *
 * 本文件是装配层：状态编排 + 子组件/特性 hooks 组合。
 * 拆分结构：fs-utils.ts（纯函数）、types.ts、entry-actions.ts（动作契约）、
 * hooks/（导航/选择/上传/预览/下载/快捷键/收藏）、components/（视图与弹层）。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ImagePreview, Progress, Spin, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { FolderOpen, Home, UploadCloud } from 'lucide-react';
import { useTerminalExtract, useTerminalFileOperation, useTerminalSearch } from '@/hooks/queries/terminal-files';
import FilePreviewModal from '@/components/FilePreviewModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { confirmDelete } from '@/utils/confirm';
import { permStringToOctal } from './fs-utils';
import type { EntryActions } from './entry-actions';
import type { FmDialogState, FsEntry, SortState, ViewMode } from './types';
import { useFsNavigation } from './hooks/useFsNavigation';
import { useFsSelection } from './hooks/useFsSelection';
import { useFsUpload } from './hooks/useFsUpload';
import { useFsPreview } from './hooks/useFsPreview';
import { useFsDownload } from './hooks/useFsDownload';
import { useFsShortcuts } from './hooks/useFsShortcuts';
import { useBookmarks } from './hooks/useBookmarks';
import { FmToolbarActions, FmToolbarNav } from './components/FmToolbar';
import FmSidebar from './components/FmSidebar';
import FmListView from './components/FmListView';
import VirtualGrid from './components/VirtualGrid';
import FmContextMenu from './components/FmContextMenu';
import FmDialogs from './components/FmDialogs';
import FmSearchModal from './components/FmSearchModal';
import FmPropsSheet from './components/FmPropsSheet';
import FmEditorSheet from './components/FmEditorSheet';
import FmConflictModal from './components/FmConflictModal';
import FolderPickerModal from './components/FolderPickerModal';
import './FileManagerPage.css';
import { HostSelector } from '@/components/HostSelector';
import { useOpsHostSelection } from '@/hooks/useOpsHostSelection';
import { RemoteHostFiles } from './RemoteHostFiles';

function LocalFileManagerPage() {
  // ── 视图状态 ──────────────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showHidden, setShowHidden] = useState(false);
  const [sortState, setSortState] = useState<SortState | null>(null);

  // ── 弹层状态 ──────────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<FmDialogState>(null);
  const [ctxEntry, setCtxEntry] = useState<{ entry: FsEntry; x: number; y: number } | null>(null);
  const [folderPicker, setFolderPicker] = useState<{ mode: 'move' | 'copy'; entries: FsEntry[] } | null>(null);
  const [propsEntry, setPropsEntry] = useState<FsEntry | null>(null);
  const [propsChecksumAlgo, setPropsChecksumAlgo] = useState<'sha256' | null>(null);
  const [editorEntry, setEditorEntry] = useState<FsEntry | null>(null);
  const [searchKw, setSearchKw] = useState('');
  const [searchTerm, setSearchTerm] = useState<{ dir: string; keyword: string } | null>(null);

  // ── 特性 hooks ────────────────────────────────────────────────────────────
  const selection = useFsSelection();
  const nav = useFsNavigation({
    onNavigate: () => {
      selection.clearSelect();
      setKeyword('');
    },
  });
  const { currentPath, rootInfo, listQuery } = nav;
  const entries = useMemo(() => listQuery.data?.entries ?? [], [listQuery.data]);
  const loading = nav.rootInfoQuery.isFetching || listQuery.isFetching;

  const upload = useFsUpload(currentPath);
  const bookmarks = useBookmarks(currentPath);
  const fileOperationMutation = useTerminalFileOperation();
  const extractTask = useTerminalExtract();

  // ── 过滤 + 排序 + 侧栏 ────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const base = entries
      .filter((e) => showHidden || !e.name.startsWith('.'))
      .filter((e) => !keyword || e.name.toLowerCase().includes(keyword.toLowerCase()));
    // 始终文件夹优先；组内按排序状态（默认名称升序）
    const dirWeight = (e: FsEntry) => (e.type === 'dir' ? 0 : 1);
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    const cmp = (a: FsEntry, b: FsEntry): number => {
      const dw = dirWeight(a) - dirWeight(b);
      if (dw !== 0) return dw;
      const field = sortState?.field ?? 'name';
      const dir = sortState?.order === 'descend' ? -1 : 1;
      if (field === 'size') return (a.size - b.size) * dir || collator.compare(a.name, b.name);
      if (field === 'mtime') return a.mtime.localeCompare(b.mtime) * dir || collator.compare(a.name, b.name);
      return collator.compare(a.name, b.name) * dir;
    };
    return [...base].sort(cmp);
  }, [entries, showHidden, keyword, sortState]);

  const sidebarDirs = entries.filter((e) => e.type === 'dir');

  const preview = useFsPreview(filteredEntries);
  const download = useFsDownload({
    currentPath,
    filteredEntries,
    selectedPaths: selection.selectedPaths,
    fileOperationMutation,
    deleteEntriesMutation: selection.deleteEntriesMutation,
  });

  // ── 深度搜索（enabled 由 searchTerm 驱动） ────────────────────────────────
  const searchQuery = useTerminalSearch(searchTerm?.dir ?? '', searchTerm?.keyword ?? '', !!searchTerm);
  const searchResults = searchTerm ? searchQuery.data?.entries ?? [] : null;
  // 触顶截断时结果不完整，必须让用户知道，否则会把「没搜到」误当成「不存在」
  const searchTruncated = !!searchQuery.data?.truncated;
  const searching = searchQuery.isFetching;

  const runSearch = () => {
    const kw = searchKw.trim();
    if (!kw) { setSearchTerm(null); return; }
    // 同目录同关键词再次回车：强制重新搜索（内容可能已变化）
    if (searchTerm && searchTerm.dir === currentPath && searchTerm.keyword === kw) {
      void searchQuery.refetch();
      return;
    }
    setSearchTerm({ dir: currentPath, keyword: kw });
  };

  // ── 文件操作 ──────────────────────────────────────────────────────────────
  const handleDelete = async (paths: string[]) => {
    await selection.deleteEntriesMutation.mutateAsync(paths);
    Toast.success(`已删除 ${paths.length} 项`);
    selection.clearSelect();
  };

  const handlePaste = async () => {
    const { clipboard } = selection;
    if (!clipboard || !currentPath) return;
    const { paths, op } = clipboard;
    const items = paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
    const done = await selection.transferEntries(items, currentPath, op === 'copy' ? 'copy' : 'move');
    if (done === -1) return;
    Toast.success(done > 0 ? `已${op === 'copy' ? '复制' : '移动'} ${done} 项` : '没有需要处理的项');
    if (clipboard.op === 'cut') selection.setClipboard(null);
  };

  const handleFolderPickerConfirm = async (destDir: string) => {
    if (!folderPicker) return;
    const { mode, entries: pickedEntries } = folderPicker;
    const items = pickedEntries.map((e) => ({ path: e.path, name: e.path.split(/[\\/]/).pop() ?? e.name }));
    const done = await selection.transferEntries(items, destDir, mode);
    if (done === -1) return;
    const verb = mode === 'move' ? '移动' : '复制';
    Toast.success(done > 0 ? `已${verb} ${done} 项` : '没有需要处理的项');
    setFolderPicker(null);
  };

  const handleExtract = async (entry: FsEntry) => {
    await extractTask.mutateAsync({ body: { path: entry.path } });
    // 解压已转为后台任务：进度与取消由任务托盘承载，页面只确认已受理
    Toast.success('解压任务已提交，可在任务中心查看进度');
  };

  const openEntry = (entry: FsEntry) => {
    if (entry.type === 'dir') void nav.navigateTo(entry.path);
    else void preview.handlePreview(entry);
  };

  // ── 条目动作（表格操作列与右键菜单共享） ──────────────────────────────────
  const entryActions: EntryActions = {
    navigateTo: nav.navigateTo,
    onPreview: (entry) => void preview.handlePreview(entry),
    onEdit: (entry) => setEditorEntry(entry),
    onDownload: download.handleDownload,
    onRename: (entry) => setDialog({ mode: 'rename', entry, value: entry.name }),
    onCopyTo: (list) => setFolderPicker({ mode: 'copy', entries: list }),
    onMoveTo: (list) => setFolderPicker({ mode: 'move', entries: list }),
    onCompress: (list, defaultName) => setDialog({ mode: 'compress', selEntries: list, value: defaultName }),
    onExtract: (entry) => void handleExtract(entry),
    onChecksum: (entry) => { setPropsChecksumAlgo('sha256'); setPropsEntry(entry); },
    onChmod: (entry) => setDialog({ mode: 'chmod', entry, value: permStringToOctal(entry.permissions) }),
    onProps: (entry) => { setPropsChecksumAlgo(null); setPropsEntry(entry); },
    onDelete: (paths) => {
      confirmDelete({
        title: paths.length > 1 ? `确定删除选中的 ${paths.length} 项吗？` : '确定删除此项吗？',
        onOk: () => handleDelete(paths),
      });
    },
    onUploadTo: (dirPath) => upload.openUploadPicker(dirPath),
  };

  // ── 键盘快捷键 ────────────────────────────────────────────────────────────
  const anyOverlayOpen = !!(dialog || folderPicker || propsEntry || preview.preview || preview.previewVisible
    || ctxEntry || searchTerm || editorEntry || selection.conflictAsk || nav.pathEditing);

  useFsShortcuts(
    {
      selectedPaths: selection.selectedPaths,
      filteredEntries,
      clipboard: selection.clipboard,
      anyOverlayOpen,
      currentPath,
    },
    {
      setSelectedPaths: selection.setSelectedPaths,
      setClipboard: selection.setClipboard,
      setDialog,
      handlePaste,
      handleDelete,
      handlePreview: preview.handlePreview,
      navigateTo: nav.navigateTo,
      goUp: nav.goUp,
      startPathEdit: nav.startPathEdit,
    },
  );

  // ── 内容区高度（用于 Table 虚拟滚动） ─────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ob = new ResizeObserver((obEntries) => {
      for (const entry of obEntries) setContentHeight(Math.floor(entry.contentRect.height));
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  // ── 渲染内容区 ────────────────────────────────────────────────────────────
  const renderContent = () => {
    // 仅首载（无任何数据）时整区 Spin；目录切换保留旧列表 + 顶部细进度条，避免闪白
    if (loading && !listQuery.data) return <div className="fm-content__loading"><Spin size="large" /></div>;
    if (filteredEntries.length === 0) {
      return (
        <div className="fm-content__empty">
          <FolderOpen size={48} strokeWidth={1.2} style={{ opacity: 0.3 }} />
          <Typography.Text type="tertiary">目录为空</Typography.Text>
        </div>
      );
    }

    if (viewMode === 'grid') {
      return (
        <VirtualGrid
          entries={filteredEntries}
          selectedPaths={selection.selectedPaths}
          cutPaths={selection.clipboard?.op === 'cut' ? new Set(selection.clipboard.paths) : undefined}
          onSelect={(path) => selection.toggleSelect(path)}
          onOpen={openEntry}
          onContextMenu={(ev, e) => { ev.preventDefault(); setCtxEntry({ entry: e, x: ev.clientX, y: ev.clientY }); }}
        />
      );
    }

    return (
      <FmListView
        entries={filteredEntries}
        isWindows={rootInfo?.isWindows ?? false}
        loading={loading}
        contentHeight={contentHeight}
        sortState={sortState}
        onSortChange={setSortState}
        selectedPaths={selection.selectedPaths}
        onSelectionChange={selection.setSelectedPaths}
        onToggleSelect={selection.toggleSelect}
        clipboard={selection.clipboard}
        onRefresh={nav.refresh}
        onOpenEntry={openEntry}
        onContextMenu={(e, r) => { e.preventDefault(); setCtxEntry({ entry: r, x: e.clientX, y: e.clientY }); }}
        actions={entryActions}
      />
    );
  };

  // ── 渲染 ──────────────────────────────────────────────────────────────────
  return (
    <MasterDetailLayout
      defaultSize={220}
      minSize={160}
      maxSize={380}
      persistKey="file-manager"
      collapsible
      master={
        <>
          <MasterDetailLayout.Header
            extra={
              rootInfo?.home && (
                <Tooltip content="主目录">
                  <Button
                    size="small"
                    theme="borderless"
                    type="tertiary"
                    icon={<Home size={13} />}
                    onClick={() => void nav.navigateTo(rootInfo.home)}
                  />
                </Tooltip>
              )
            }
          >
            <Typography.Text strong style={{ fontSize: 13 }}>目录导航</Typography.Text>
          </MasterDetailLayout.Header>
          <FmSidebar
            rootInfo={rootInfo}
            currentPath={currentPath}
            sidebarDirs={sidebarDirs}
            bookmarks={bookmarks.bookmarks}
            onNavigate={(p) => void nav.navigateTo(p)}
            onRemoveBookmark={bookmarks.removeBookmark}
          />
        </>
      }
      detail={
        <>
          <MasterDetailLayout.Header>
            <div className="fm-toolbar">
              <FmToolbarNav
                canBack={nav.canBack}
                canForward={nav.canForward}
                onBack={() => void nav.goBack()}
                onForward={() => void nav.goForward()}
                pathEditing={nav.pathEditing}
                pathDraft={nav.pathDraft}
                onPathDraftChange={nav.setPathDraft}
                onPathEditingChange={nav.setPathEditing}
                onStartPathEdit={nav.startPathEdit}
                currentPath={currentPath}
                breadcrumbs={nav.breadcrumbs}
                onNavigate={(p) => void nav.navigateTo(p)}
              />
              <FmToolbarActions
                keyword={keyword}
                onKeywordChange={setKeyword}
                searchKw={searchKw}
                onSearchKwChange={setSearchKw}
                onRunSearch={runSearch}
                loading={loading}
                onRefresh={nav.refresh}
                onNewDir={() => setDialog({ mode: 'newDir', value: '' })}
                onNewFile={() => setDialog({ mode: 'newFile', value: '' })}
                onUploadFiles={() => upload.openUploadPicker()}
                onUploadDir={upload.openDirUploadPicker}
                isBookmarked={bookmarks.isBookmarked}
                onToggleBookmark={bookmarks.toggleBookmark}
                clipboard={selection.clipboard}
                pasteLoading={selection.fileOperationMutation.isPending || selection.deleteEntriesMutation.isPending}
                onPaste={() => void handlePaste()}
                selectedCount={selection.selectedPaths.size}
                onBatchDownload={() => void download.handleBatchDownload()}
                onBatchCopy={() => selection.setClipboard({ paths: [...selection.selectedPaths], op: 'copy' })}
                onBatchCut={() => selection.setClipboard({ paths: [...selection.selectedPaths], op: 'cut' })}
                onBatchCompress={() => {
                  const sel = filteredEntries.filter((e) => selection.selectedPaths.has(e.path));
                  setDialog({ mode: 'compress', selEntries: sel, value: 'archive.zip' });
                }}
                onBatchDelete={() => void handleDelete([...selection.selectedPaths])}
                deleteLoading={selection.deleteEntriesMutation.isPending}
                showHidden={showHidden}
                onToggleHidden={() => setShowHidden((v) => !v)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
            </div>
          </MasterDetailLayout.Header>

          <MasterDetailLayout.Body scroll="hidden" style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              className="fm-content"
              ref={contentRef}
              onDragEnter={upload.handleDragEnter}
              onDragOver={upload.handleDragOver}
              onDragLeave={upload.handleDragLeave}
              onDrop={upload.handleDrop}
            >
              {/* 目录切换中：顶部细进度条（保留旧列表，不闪白） */}
              {loading && !!listQuery.data && <div className="fm-progress-line" />}
              {renderContent()}
              {upload.dragOver && (
                <div className="fm-dropzone">
                  <UploadCloud size={40} strokeWidth={1.5} />
                  <Typography.Text strong>释放以上传到当前目录</Typography.Text>
                  <Typography.Text type="tertiary" size="small">{currentPath}</Typography.Text>
                </div>
              )}
              {upload.uploading.length > 0 && (
                <div className="fm-upload-progress">
                  <Typography.Text size="small" strong>
                    上传中（{upload.uploading.filter((u) => u.progress >= 100).length}/{upload.uploading.length}）
                  </Typography.Text>
                  {upload.uploading.map((u) => (
                    <div key={u.name} style={{ marginTop: 4 }}>
                      <Typography.Text size="small" ellipsis style={{ display: 'block' }}>{u.name}</Typography.Text>
                      <Progress
                        percent={Math.min(100, u.progress)}
                        size="small"
                        showInfo={false}
                        strokeWidth={4}
                        style={{ marginTop: 3 }}
                        aria-label={`${u.name} 上传进度`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </MasterDetailLayout.Body>

          <input ref={upload.ctxUploadInputRef} type="file" multiple style={{ display: 'none' }} onChange={upload.handleUploadChange} />
          <input
            ref={upload.dirUploadInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void upload.handleDirUploadChange(e)}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />

          <FmContextMenu
            ctx={ctxEntry}
            isWindows={rootInfo?.isWindows ?? false}
            actions={entryActions}
            onClose={() => setCtxEntry(null)}
          />

          <FmDialogs
            dialog={dialog}
            setDialog={setDialog}
            currentPath={currentPath}
            isWindows={rootInfo?.isWindows ?? false}
            fileOperationMutation={fileOperationMutation}
          />

          {/* ── 图片画廊预览 ── */}
          <ImagePreview
            src={preview.previewSrcList}
            visible={preview.previewVisible}
            currentIndex={preview.previewCurrentIndex}
            onChange={preview.handleGalleryChange}
            onVisibleChange={(v) => { if (!v) preview.closeGallery(); }}
            infinite
          />

          {/* ── 通用文件预览 (PDF/音视频/Excel/Word/Markdown/ZIP/代码等) ── */}
          <FilePreviewModal
            fileUrl={preview.preview?.url ?? ''}
            fileName={preview.preview?.name}
            mimeType={preview.preview?.mimeType}
            visible={!!preview.preview}
            onClose={() => preview.setPreview(null)}
            onFallback={() => { Toast.warning('该文件不支持在线预览，请下载后查看'); preview.setPreview(null); }}
          />

          {/* ── 文件夹选择器（移动/复制） ── */}
          <FolderPickerModal
            visible={!!folderPicker}
            title={folderPicker?.mode === 'move' ? '移动到' : '复制到'}
            initialPath={currentPath}
            drives={rootInfo?.drives ?? []}
            onConfirm={(destDir) => void handleFolderPickerConfirm(destDir)}
            onCancel={() => setFolderPicker(null)}
          />

          {/* ── 深度搜索结果 ── */}
          <FmSearchModal
            visible={searchTerm !== null}
            dir={currentPath}
            keyword={searchTerm?.keyword ?? ''}
            searching={searching}
            results={searchResults}
            truncated={searchTruncated}
            onClose={() => setSearchTerm(null)}
            onGoto={(r) => {
              setSearchTerm(null);
              if (r.type === 'dir') {
                void nav.navigateTo(r.path);
              } else {
                // 前往父目录并选中高亮目标文件（navigateTo 会清空选择，需在其后设置）
                const parent = r.path.replace(/[/\\][^/\\]*$/, '') || r.path;
                void nav.navigateTo(parent).then(() => selection.setSelectedPaths(new Set([r.path])));
              }
            }}
          />

          {/* ── 文件属性详情面板 ── */}
          <FmPropsSheet
            entry={propsEntry}
            onClose={() => setPropsEntry(null)}
            initialChecksumAlgo={propsChecksumAlgo}
          />

          {/* ── 同名冲突处理选择 ── */}
          <FmConflictModal
            conflict={selection.conflictAsk}
            onSettle={selection.settleConflictAsk}
          />

          {/* ── 在线编辑抽屉（Monaco，Ctrl+S 保存） ── */}
          <FmEditorSheet
            entry={editorEntry}
            onClose={() => setEditorEntry(null)}
          />
        </>
      }
    />
  );
}

export default function FileManagerPage() {
  const [hostId, setHostId] = useOpsHostSelection();
  return (
    <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <HostSelector value={hostId} onChange={setHostId} />
      <div style={{ flex: 1, minHeight: 0 }}>
        {hostId == null ? <LocalFileManagerPage /> : <RemoteHostFiles key={hostId} hostId={hostId} />}
      </div>
    </div>
  );
}
