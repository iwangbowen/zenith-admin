import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Dropdown, Toast, Typography } from '@douyinfe/semi-ui';
import { Download, FileArchive, FileText, ListChecks, RefreshCw, Trash2 } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem, NavListItemActions } from '@/components/NavListPanel';
import { LogWorkbench } from '@/components/log-workbench/LogWorkbench';
import type { LogLevel } from '@/components/log-workbench/log-search';
import { request } from '@/utils/request';
import DateTimeText from '@/components/DateTimeText';
import { usePermission } from '@/hooks/usePermission';
import { useUrlSelectionParams } from '@/hooks/useUrlSelectionState';
import type { LogFile } from '@zenith/shared/ops';
import { batchDownloadLogFiles, logFileDownloadUrl, useBatchDeleteLogFiles, useDeleteLogFile, useLogFiles } from '@/hooks/queries/log-files';
import { logSourceKey, type LogSource } from '@/hooks/queries/log-source';
import { confirmAndDelete, useRowSelection } from '@/components/list-page';
import { BatchDeleteButton, BatchDownloadButton } from '@/components/toolbar-controls';
import { formatBytes } from '@zenith/shared/core';
import './LogFilesPage.css';

const EMPTY_LOG_FILES: LogFile[] = [];

function parseLevelParam(value: string | null): LogLevel | undefined {
  return value === 'error' || value === 'warn' || value === 'info' || value === 'debug' ? value : undefined;
}

export default function LogFilesPage() {
  const { hasPermission } = usePermission();
  const [keyword, setKeyword] = useState('');
  // 文件与定位条件成组管理，消费深链或切换到同一文件的另一条链路时不会丢失筛选。
  const [selection, setSelection] = useUrlSelectionParams(['file', 'level', 'keyword', 'correlationId'], { replaceOnNavigate: true });
  const selectedFileKey = selection.file;

  const filesQuery = useLogFiles();
  const files = filesQuery.data ?? EMPTY_LOG_FILES;
  const selected = useMemo(
    () => (selectedFileKey ? files.find((f) => f.name === selectedFileKey) ?? null : null),
    [files, selectedFileKey],
  );
  const deleteMutation = useDeleteLogFile();
  const batchDeleteMutation = useBatchDeleteLogFiles();
  // 行键是文件名（字符串），与 Semi 表格无关但复用同一份多选状态收口
  const checkboxSelection = useRowSelection<string>();
  // 选择模式：列表以「点选查看」为主，多选框只在显式进入选择模式后出现，避免日常浏览被勾选框和操作条挤占
  const [selecting, setSelecting] = useState(false);

  const filteredFiles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return files;
    return files.filter((file) => file.name.toLowerCase().includes(normalizedKeyword));
  }, [files, keyword]);

  // 只保留仍在列表里的勾选项：日志按天轮转，文件可能在自己消失前就被选中过
  const checkedFiles = useMemo(
    () => files.filter((file) => checkboxSelection.selectedRowKeys.includes(file.name)),
    [files, checkboxSelection.selectedRowKeys],
  );
  const checkedNames = useMemo(() => checkedFiles.map((file) => file.name), [checkedFiles]);
  const checkedOnFiltered = filteredFiles.filter((file) => checkboxSelection.selectedRowKeys.includes(file.name));
  const allChecked = filteredFiles.length > 0 && checkedOnFiltered.length === filteredFiles.length;
  const someChecked = checkedOnFiltered.length > 0 && !allChecked;

  const selectFile = useCallback((file: LogFile) => {
    if (selected?.name === file.name) return;
    setSelection({ file: file.name, level: null, keyword: null, correlationId: null });
  }, [selected, setSelection]);

  // URL ?file= 深链：文件列表就绪后应用（刷新/分享链接/告警事件跳转直达）。
  // 页面可能被页签缓存复用，因此按参数值追踪而非只应用一次；
  // 目标不存在时尝试同名 .gz（日志目录中的既有归档），落定后仍不存在则清参
  useEffect(() => {
    if (!selectedFileKey) return;
    if (files.length === 0) return;
    const target = files.find((f) => f.name === selectedFileKey)
      ?? files.find((f) => f.name === `${selectedFileKey}.gz`);
    if (!target) {
      if (!filesQuery.isFetching) setSelection({ file: null, level: null, keyword: null, correlationId: null });
      return;
    }
    if (target.name !== selectedFileKey) {
      setSelection((prev) => ({ ...prev, file: target.name }));
    }
  }, [files, filesQuery.isFetching, selectedFileKey, setSelection]);

  const initialLevel = parseLevelParam(selection.level);
  const initialKeyword = selection.keyword?.trim().slice(0, 200) || undefined;
  const initialCorrelationId = selection.correlationId && /^[\w-]{8,64}$/.test(selection.correlationId)
    ? selection.correlationId
    : undefined;

  const handleDownload = async (file: LogFile) => {
    try {
      await request.download(logFileDownloadUrl(file.name), file.name);
    } catch {
      Toast.error('下载失败');
    }
  };

  const deselectFile = useCallback(() => {
    setSelection({ file: null, level: null, keyword: null, correlationId: null });
  }, [setSelection]);

  const handleDelete = (file: LogFile) => {
    confirmAndDelete({
      title: `确定要删除 ${file.name} 吗？`,
      content: '删除后无法恢复，请谨慎操作。',
      run: () => deleteMutation.mutateAsync({ params: { filename: file.name } }),
      onDeleted: () => {
        if (selected?.name === file.name) deselectFile();
      },
    });
  };

  const gzFiles = useMemo(() => files.filter((f) => f.isGzip), [files]);

  /** 退出选择模式并清空勾选：选择态不跨模式保留，避免下次进入时带着看不见的旧勾选 */
  const exitSelecting = () => {
    setSelecting(false);
    checkboxSelection.clear();
  };

  const handleCleanGz = () => {
    if (gzFiles.length === 0) return;
    const totalSize = gzFiles.reduce((sum, f) => sum + f.size, 0);
    const names = gzFiles.map((f) => f.name);
    confirmAndDelete({
      title: '确定要清理全部压缩日志吗？',
      content: `共 ${names.length} 个 .gz 文件（${formatBytes(totalSize)}），删除后无法恢复。`,
      run: () => batchDeleteMutation.mutateAsync({ body: { filenames: names } }),
      successMessage: (res) => `已清理 ${res.deleted} 个压缩日志`,
      onDeleted: () => {
        exitSelecting();
        if (selected?.isGzip) deselectFile();
      },
    });
  };

  const toggleChecked = (name: string, checked: boolean) => {
    checkboxSelection.setSelectedRowKeys((prev) => (checked
      ? prev.includes(name) ? prev : [...prev, name]
      : prev.filter((key) => key !== name)));
  };

  const toggleCheckedAll = (checked: boolean) => {
    const visible = new Set(filteredFiles.map((file) => file.name));
    checkboxSelection.setSelectedRowKeys((prev) => (checked
      ? [...prev, ...[...visible].filter((name) => !prev.includes(name))]
      : prev.filter((name) => !visible.has(name))));
  };

  const [downloading, setDownloading] = useState(false);

  /** 多选打包下载：小批量服务端直接返回 zip，超阈值转后台任务并提示去通知中心取件 */
  const handleBatchDownload = async () => {
    if (checkedNames.length === 0) return;
    setDownloading(true);
    try {
      const result = await batchDownloadLogFiles(checkedNames);
      if (result?.mode === 'task') Toast.info('文件较多，已转为后台打包，完成后会通知你下载');
    } catch {
      Toast.error('打包下载失败');
    } finally {
      setDownloading(false);
    }
  };

  const handleBatchDelete = () => {
    if (checkedNames.length === 0) return;
    confirmAndDelete({
      title: `确定要删除选中的 ${checkedNames.length} 个日志文件吗？`,
      content: '删除后无法恢复，请谨慎操作。',
      run: () => batchDeleteMutation.mutateAsync({ body: { filenames: checkedNames } }),
      successMessage: (res) => `已删除 ${res.deleted} 个日志文件`,
      onDeleted: () => {
        exitSelecting();
        if (selected && checkedNames.includes(selected.name)) deselectFile();
      },
    });
  };

  const source: LogSource | null = selected ? { kind: 'file', filename: selected.name } : null;
  const canDownload = hasPermission('system:log:files:download');
  const canDelete = hasPermission('system:log:files:delete');
  // 选择模式同时服务批量下载与批量删除：只给其中一项权限也应能进
  const canSelect = canDownload || canDelete;

  return (
    <MasterDetailLayout
      defaultSize={260}
      minSize={200}
      maxSize={480}
      persistKey="log-files"
      showDetail={selected !== null}
      onBack={deselectFile}
      master={(
          <NavListPanel
            title="日志文件"
            headerExtra={
              <>
                {/* 选中数量放头部：底部操作条在 260px 面板里只装得下图标按钮 + 全选/退出，
                    文字放那儿必被截断；标题行有空间容纳这一行短文本 */}
                {selecting && (
                  <Typography.Text type="tertiary" size="small" className="log-files-select-count">
                    {checkedNames.length > 0 ? `已选 ${checkedNames.length} 项` : `共 ${filteredFiles.length} 个文件`}
                  </Typography.Text>
                )}
                <Button
                  icon={<RefreshCw size={13} />}
                  size="small"
                  theme="borderless"
                  loading={filesQuery.isFetching}
                  onClick={() => void filesQuery.refetch()}
                />
                {canDelete && (
                  <NavListItemActions items={[
                    { key: 'clean-gz', label: `清理压缩日志（${gzFiles.length} 个）`, icon: <Trash2 size={14} />, danger: true, disabled: gzFiles.length === 0, onClick: handleCleanGz },
                  ]} />
                )}
              </>
            }
            search={{
              value: keyword,
              onChange: (value) => setKeyword(value),
              placeholder: '搜索文件名',
            }}
            loading={filesQuery.isFetching}
            emptyText={files.length === 0 ? '暂无日志文件' : '未找到匹配的日志文件'}
            /* 选择模式的入口与出口同在底部操作条，避免「顶部进入、底部退出」两处入口 */
            footer={canSelect && (selecting || filteredFiles.length > 0) ? (
              <div className="log-files-select-bar">
                {selecting ? (
                  <>
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      disabled={filteredFiles.length === 0}
                      onChange={(e) => toggleCheckedAll(Boolean(e.target.checked))}
                    >
                      全选
                    </Checkbox>
                    {/* 空白占位：撑开「全选」与右侧的退出 / 图标按钮；文字只在非选择模式出现
                        （选择模式的计数已移到面板标题行，此处再放一遍会被截断） */}
                    <Typography.Text type="tertiary" size="small" className="log-files-select-bar__hint">
                      {selecting ? null : `共 ${filteredFiles.length} 个文件`}
                    </Typography.Text>
                    {checkedNames.length > 0 && (canDownload || canDelete) && (
                      /* 两个动作整组出现、且只用图标：带文案放不进 260px 的面板一行。
                         排在「退出」左侧：退出是模式开关，位置固定在最右，勾选才浮现的动作不挤动它 */
                      <span className="log-files-select-bar__actions">
                        {canDownload && (
                          <BatchDownloadButton
                            count={checkedNames.length}
                            label="下载"
                            iconOnly
                            loading={downloading}
                            onClick={() => void handleBatchDownload()}
                          />
                        )}
                        {canDelete && (
                          <BatchDeleteButton
                            count={checkedNames.length}
                            label="删除"
                            iconOnly
                            loading={batchDeleteMutation.isPending}
                            onClick={handleBatchDelete}
                          />
                        )}
                      </span>
                    )}
                    <Button size="small" theme="borderless" onClick={exitSelecting}>退出</Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="small"
                      theme="borderless"
                      icon={<ListChecks size={13} />}
                      onClick={() => setSelecting(true)}
                    >
                      选择
                    </Button>
                    <Typography.Text type="tertiary" size="small" className="log-files-select-bar__hint">
                      共 {filteredFiles.length} 个文件
                    </Typography.Text>
                  </>
                )}
              </div>
            ) : undefined}
            dataSource={filteredFiles}
            renderItem={(file) => {
              const active = selected?.name === file.name;
              return (
                <NavListItem
                  key={file.name}
                  active={active}
                  onClick={() => selectFile(file)}
                  checkbox={canSelect && selecting ? {
                    checked: checkboxSelection.selectedRowKeys.includes(file.name),
                    onChange: (checked) => toggleChecked(file.name, checked),
                    'aria-label': `选择 ${file.name}`,
                  } : undefined}
                  icon={file.isGzip
                    ? <FileArchive size={13} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
                    : <FileText size={13} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />}
                  primary={file.name}
                  meta={
                    <>
                      <span>{formatBytes(file.size)}</span>
                      <span title={file.modifiedAt}><DateTimeText value={file.modifiedAt} /></span>
                    </>
                  }
                  extra={
                    <NavListItemActions items={[
                      { key: 'download', label: '下载', icon: <Download size={14} />, hidden: !canDownload, onClick: () => void handleDownload(file) },
                      { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, hidden: !canDelete, onClick: () => handleDelete(file) },
                    ]} />
                  }
                />
              );
            }}
          />
      )}
      detail={(
        <>
          {selected && source ? (
            <LogWorkbench
              key={JSON.stringify([logSourceKey(source), initialLevel, initialKeyword, initialCorrelationId])}
              source={source}
              title={(
                <>
                  <FileText size={14} style={{ flexShrink: 0, color: 'var(--semi-color-primary)' }} />
                  <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                    {selected.name}
                  </Typography.Text>
                </>
              )}
              canTail={!selected.isGzip && hasPermission('system:log:files')}
              initialLevel={initialLevel}
              initialKeyword={initialKeyword}
              initialCorrelationId={initialCorrelationId}
              onCorrelationIdChange={(correlationId) => setSelection((prev) => ({ ...prev, correlationId: correlationId ?? null }))}
              exportName={selected.name}
              menuExtra={(canDownload || canDelete) ? (
                <>
                  {canDownload && (
                    <Dropdown.Item onClick={() => void handleDownload(selected)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Download size={14} /> 下载
                      </span>
                    </Dropdown.Item>
                  )}
                  {canDelete && (
                    <Dropdown.Item type="danger" onClick={() => handleDelete(selected)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Trash2 size={14} /> 删除
                      </span>
                    </Dropdown.Item>
                  )}
                </>
              ) : undefined}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <FileText size={40} style={{ color: 'var(--semi-color-text-3)' }} />
              <Typography.Text type="tertiary">请从左侧选择一个日志文件查看</Typography.Text>
            </div>
          )}
        </>
      )}
    />
  );
}