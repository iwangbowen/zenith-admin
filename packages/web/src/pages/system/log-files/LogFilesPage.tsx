import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Dropdown, Toast, Typography } from '@douyinfe/semi-ui';
import { Icon } from '@iconify/react';
import { Download, FileText, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { LogWorkbench } from '@/components/log-workbench/LogWorkbench';
import type { LogLevel } from '@/components/log-workbench/log-search';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useUrlSelectionState } from '@/hooks/useUrlSelectionState';
import type { LogFile } from '@zenith/shared/ops';
import { logFileDownloadUrl, useDeleteLogFile, useLogFiles } from '@/hooks/queries/log-files';
import { logSourceKey, type LogSource } from '@/hooks/queries/log-source';
import { confirmAndDelete } from '@/components/list-page';
import { formatBytes } from '@zenith/shared/core';

const EMPTY_LOG_FILES: LogFile[] = [];

function parseLevelParam(value: string | null): LogLevel | undefined {
  return value === 'error' || value === 'warn' || value === 'info' || value === 'debug' ? value : undefined;
}

export default function LogFilesPage() {
  const { hasPermission } = usePermission();
  const [keyword, setKeyword] = useState('');
  // 选中文件以 `?file=` 同步到 URL（刷新/分享链接/告警事件跳转直达）；选中对象按文件名派生
  const [selectedFileKey, setSelectedFileKey] = useUrlSelectionState('file');
  // ?level= 等伴随参数仍直接读取
  const [searchParams] = useSearchParams();

  const filesQuery = useLogFiles();
  const files = filesQuery.data ?? EMPTY_LOG_FILES;
  const selected = useMemo(
    () => (selectedFileKey ? files.find((f) => f.name === selectedFileKey) ?? null : null),
    [files, selectedFileKey],
  );
  const deleteMutation = useDeleteLogFile();

  const filteredFiles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return files;
    return files.filter((file) => file.name.toLowerCase().includes(normalizedKeyword));
  }, [files, keyword]);

  // 已应用到工作台的选中项：点选路径在 selectFile 中登记，URL 驱动的选中在下方 effect 中登记
  const appliedFileParamRef = useRef<string | null>(null);

  const selectFile = useCallback((file: LogFile) => {
    if (selected?.name === file.name) return;
    appliedFileParamRef.current = file.name;
    setSelectedFileKey(file.name);
  }, [selected, setSelectedFileKey]);

  // URL ?file= 深链：文件列表就绪后应用（刷新/分享链接/告警事件跳转直达）。
  // 页面可能被页签缓存复用，因此按参数值追踪而非只应用一次；
  // 目标不存在时尝试同名 .gz（日志目录中的既有归档），落定后仍不存在则清参
  useEffect(() => {
    if (!selectedFileKey) {
      appliedFileParamRef.current = null;
      return;
    }
    if (files.length === 0) return;
    if (appliedFileParamRef.current === selectedFileKey) return;
    const target = files.find((f) => f.name === selectedFileKey)
      ?? files.find((f) => f.name === `${selectedFileKey}.gz`);
    if (!target) {
      if (!filesQuery.isFetching) setSelectedFileKey(null);
      return;
    }
    if (target.name !== selectedFileKey) {
      setSelectedFileKey(target.name);
      return;
    }
    appliedFileParamRef.current = target.name;
  }, [files, filesQuery.isFetching, selectedFileKey, setSelectedFileKey]);

  // ?level= 只作用于 URL 驱动的选中（告警跳转带 error/warn）：渲染期 ref 尚未登记即视为深链；
  // 工作台仅在挂载时读取该值，点选其他文件后重挂载即回到「全部级别」
  const initialLevel = selected && appliedFileParamRef.current !== selected.name
    ? parseLevelParam(searchParams.get('level'))
    : undefined;

  const handleDownload = async (file: LogFile) => {
    try {
      await request.download(logFileDownloadUrl(file.name), file.name);
    } catch {
      Toast.error('下载失败');
    }
  };

  const deselectFile = useCallback(() => {
    appliedFileParamRef.current = null;
    setSelectedFileKey(null);
  }, [setSelectedFileKey]);

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

  const handleCleanGz = () => {
    if (gzFiles.length === 0) return;
    const totalSize = gzFiles.reduce((sum, f) => sum + f.size, 0);
    confirmAndDelete({
      title: '确定要清理全部压缩日志吗？',
      content: `共 ${gzFiles.length} 个 .gz 文件（${formatBytes(totalSize)}），删除后无法恢复。`,
      run: async () => {
        for (const file of gzFiles) {
          await deleteMutation.mutateAsync({ params: { filename: file.name } });
        }
      },
      successMessage: `已清理 ${gzFiles.length} 个压缩日志`,
      onDeleted: () => {
        if (selected?.isGzip) deselectFile();
      },
    });
  };

  const source: LogSource | null = selected ? { kind: 'file', filename: selected.name } : null;
  const canDownload = hasPermission('system:log:files:download');
  const canDelete = hasPermission('system:log:files:delete');

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
                <Button
                  icon={<RefreshCw size={13} />}
                  size="small"
                  theme="borderless"
                  loading={filesQuery.isFetching}
                  onClick={() => void filesQuery.refetch()}
                />
                {canDelete && (
                  <Dropdown
                    trigger="click"
                    position="bottomRight"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item
                          type="danger"
                          disabled={gzFiles.length === 0}
                          onClick={handleCleanGz}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Trash2 size={14} /> 清理压缩日志（{gzFiles.length} 个）
                          </span>
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    }
                  >
                    <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} />
                  </Dropdown>
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
            dataSource={filteredFiles}
            renderItem={(file) => {
              const active = selected?.name === file.name;
              return (
                <NavListItem
                  key={file.name}
                  active={active}
                  onClick={() => selectFile(file)}
                  icon={<Icon icon="vscode-icons:file-type-log" width={13} height={13} />}
                  primary={file.name}
                  meta={
                    <>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 4px',
                        borderRadius: 'var(--semi-border-radius-small)',
                        lineHeight: '14px',
                        background: file.isGzip ? 'var(--semi-color-fill-2)' : 'var(--semi-color-primary-light-default)',
                        color: file.isGzip ? 'var(--semi-color-text-2)' : 'var(--semi-color-primary)',
                      }}>
                        {file.isGzip ? 'gz' : 'log'}
                      </span>
                      <span>{formatBytes(file.size)}</span>
                      <span>{formatDateTime(file.modifiedAt)}</span>
                    </>
                  }
                  extra={
                    <Dropdown
                      trigger="click"
                      position="bottomRight"
                      clickToHide
                      render={
                        <Dropdown.Menu>
                          {canDownload && (
                            <Dropdown.Item onClick={() => void handleDownload(file)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Download size={14} /> 下载
                              </span>
                            </Dropdown.Item>
                          )}
                          {canDelete && (
                            <Dropdown.Item
                              type="danger"
                              onClick={() => handleDelete(file)}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Trash2 size={14} /> 删除
                              </span>
                            </Dropdown.Item>
                          )}
                        </Dropdown.Menu>
                      }
                    >
                      <Button
                        theme="borderless"
                        size="small"
                        icon={<MoreHorizontal size={14} />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
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
              key={logSourceKey(source)}
              source={source}
              title={(
                <>
                  <Icon icon="vscode-icons:file-type-log" width={14} height={14} style={{ flexShrink: 0 }} />
                  <Typography.Text style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
                    {selected.name}
                  </Typography.Text>
                </>
              )}
              canTail={!selected.isGzip && hasPermission('system:log:files')}
              initialLevel={initialLevel}
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
