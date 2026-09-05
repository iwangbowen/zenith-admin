import { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, SideSheet, Space, Spin, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ArrowUp, FolderPlus, RefreshCw, Upload, FilePlus } from 'lucide-react';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import PageLoading from '@/components/PageLoading';
import { confirmDelete } from '@/utils/confirm';
import { request } from '@/utils/request';
import {
  useHostFileContent,
  useHostFileHome,
  useHostFileList,
  useHostFileMutation,
  useHostFileUpload,
  hostFileDownloadUrl,
} from '@/hooks/queries/terminal-files';
import type { SftpFileEntry } from '@zenith/shared/ops';
import { permStringToOctal } from './fs-utils';
import { formatBytes } from '@zenith/shared/core';

const { Text } = Typography;

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`;
}

type ActionDialog =
  | { kind: 'create'; type: 'file' | 'dir' }
  | { kind: 'rename'; entry: SftpFileEntry }
  | { kind: 'chmod'; entry: SftpFileEntry }
  | null;

export function RemoteHostFiles({ hostId }: Readonly<{ hostId: number }>) {
  const homeQuery = useHostFileHome(hostId);
  const [currentPath, setCurrentPath] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const listQuery = useHostFileList(hostId, currentPath, !!currentPath);
  const mutation = useHostFileMutation(hostId);
  const uploadMutation = useHostFileUpload(hostId);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [modeValue, setModeValue] = useState(0o644);
  const [editingPath, setEditingPath] = useState('');
  const contentQuery = useHostFileContent(hostId, editingPath, !!editingPath);
  const [draftContent, setDraftContent] = useState('');
  const [draftDirty, setDraftDirty] = useState(false);

  useEffect(() => {
    if (!homeQuery.data?.home) return;
    setCurrentPath(homeQuery.data.home);
    setPathDraft(homeQuery.data.home);
  }, [homeQuery.data?.home]);

  useEffect(() => {
    if (contentQuery.data?.path === editingPath && !draftDirty) {
      setDraftContent(contentQuery.data.content);
    }
  }, [contentQuery.data, draftDirty, editingPath]);

  const navigate = (path: string) => {
    setCurrentPath(path);
    setPathDraft(path);
  };

  const openEntry = (entry: SftpFileEntry) => {
    if (entry.type === 'dir') navigate(entry.path);
    else {
      setDraftContent('');
      setDraftDirty(false);
      setEditingPath(entry.path);
    }
  };

  const closeEditor = () => {
    setEditingPath('');
    setDraftContent('');
    setDraftDirty(false);
  };

  const submitDialog = async () => {
    if (!dialog) return;
    if (dialog.kind === 'create') {
      const name = dialogValue.trim();
      if (!name || name.includes('/')) throw new Error('请输入不含 / 的名称');
      await mutation.mutateAsync({ kind: 'create', path: joinPath(currentPath, name), type: dialog.type });
      Toast.success(dialog.type === 'dir' ? '目录已创建' : '文件已创建');
    } else if (dialog.kind === 'rename') {
      const name = dialogValue.trim();
      if (!name || name.includes('/')) throw new Error('请输入不含 / 的名称');
      const parent = dialog.entry.path.slice(0, dialog.entry.path.lastIndexOf('/')) || '/';
      await mutation.mutateAsync({ kind: 'rename', from: dialog.entry.path, to: joinPath(parent, name) });
      Toast.success('已重命名');
    } else {
      await mutation.mutateAsync({ kind: 'chmod', path: dialog.entry.path, mode: modeValue });
      Toast.success('权限已修改');
    }
    setDialog(null);
  };

  const columns: ColumnProps<SftpFileEntry>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string, entry) => (
        <Button theme="borderless" size="small" onClick={() => openEntry(entry)}>
          {entry.type === 'dir' ? `📁 ${name}` : name}
        </Button>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 90, render: (value: string) => value === 'dir' ? '目录' : '文件' },
    { title: '大小', dataIndex: 'size', width: 120, render: (value: number, entry) => entry.type === 'dir' ? '—' : formatBytes(value) },
    { title: '权限', dataIndex: 'permissions', width: 120, render: (value?: string) => value ?? '—' },
    { title: '修改时间', dataIndex: 'mtime', width: 180 },
    createOperationColumn<SftpFileEntry>({
      width: 180,
      desktopInlineKeys: ['open', 'download'],
      actions: (entry) => [
        { key: 'open', label: entry.type === 'dir' ? '打开' : '编辑', onClick: () => openEntry(entry) },
        {
          key: 'download',
          label: '下载',
          hidden: entry.type === 'dir',
          onClick: () => void request.download(hostFileDownloadUrl(hostId, entry.path), entry.name),
        },
        {
          key: 'rename',
          label: '重命名',
          onClick: () => {
            setDialogValue(entry.name);
            setDialog({ kind: 'rename', entry });
          },
        },
        {
          key: 'chmod',
          label: '权限',
          onClick: () => {
            const octal = permStringToOctal(entry.permissions);
            setModeValue(Number.parseInt(octal || '644', 8));
            setDialog({ kind: 'chmod', entry });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              content: `确认删除「${entry.name}」${entry.type === 'dir' ? '及其全部内容' : ''}？`,
              onOk: async () => {
                await mutation.mutateAsync({ kind: 'delete', path: entry.path });
                Toast.success('已删除');
              },
            });
          },
        },
      ],
    }),
  ];

  if (homeQuery.isPending) return <PageLoading inline />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, gap: 10 }}>
      <Space wrap>
        <Button
          icon={<ArrowUp size={14} />}
          disabled={!listQuery.data?.parent}
          onClick={() => listQuery.data?.parent && navigate(listQuery.data.parent)}
        >
          上级
        </Button>
        <Input
          value={pathDraft}
          onChange={setPathDraft}
          onEnterPress={() => navigate(pathDraft.trim() || '/')}
          style={{ width: 380 }}
        />
        <Button icon={<RefreshCw size={14} />} onClick={() => void listQuery.refetch()} loading={listQuery.isFetching}>刷新</Button>
        <Button icon={<FolderPlus size={14} />} onClick={() => { setDialogValue(''); setDialog({ kind: 'create', type: 'dir' }); }}>新建目录</Button>
        <Button icon={<FilePlus size={14} />} onClick={() => { setDialogValue(''); setDialog({ kind: 'create', type: 'file' }); }}>新建文件</Button>
        <Button icon={<Upload size={14} />} onClick={() => uploadRef.current?.click()} loading={uploadMutation.isPending}>上传</Button>
        <input
          ref={uploadRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const formData = new FormData();
            formData.append('path', currentPath);
            formData.append('file', file);
            void uploadMutation.mutateAsync({ formData }).then(() => Toast.success('上传成功'));
          }}
        />
      </Space>

      <ConfigurableTable
        bordered
        rowKey="path"
        columns={columns}
        dataSource={listQuery.data?.entries ?? []}
        loading={listQuery.isFetching}
        pagination={false}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        empty="目录为空"
      />

      <AppModal
        title={dialog?.kind === 'create' ? `新建${dialog.type === 'dir' ? '目录' : '文件'}` : dialog?.kind === 'rename' ? '重命名' : '修改权限'}
        visible={dialog != null}
        onCancel={() => setDialog(null)}
        onOk={submitDialog}
        confirmLoading={mutation.isPending}
        width={480}
      >
        {dialog?.kind === 'chmod' ? (
          <Space vertical align="start">
            <Text>权限值（八进制）</Text>
            <InputNumber
              value={Number(modeValue.toString(8))}
              onChange={(value) => {
                const parsed = Number.parseInt(String(value ?? 644), 8);
                setModeValue(Number.isNaN(parsed) ? 0o644 : parsed);
              }}
              min={0}
              max={7777}
            />
          </Space>
        ) : (
          <Input value={dialogValue} onChange={setDialogValue} placeholder="名称" autoFocus />
        )}
      </AppModal>

      <SideSheet
        title={`编辑：${editingPath.split('/').pop() ?? editingPath}`}
        visible={!!editingPath}
        width={760}
        onCancel={closeEditor}
        footer={(
          <Space>
            <Button onClick={closeEditor}>取消</Button>
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={
                contentQuery.isFetching
                || !contentQuery.data
                || contentQuery.data.path !== editingPath
              }
              onClick={async () => {
                await mutation.mutateAsync({
                  kind: 'write',
                  path: editingPath,
                  content: draftContent,
                  baseEtag: contentQuery.data?.etag,
                });
                setDraftDirty(false);
                Toast.success('文件已保存');
              }}
            >
              保存
            </Button>
          </Space>
        )}
      >
        <Spin spinning={contentQuery.isFetching}>
          <TextArea
            value={draftContent}
            onChange={(value) => {
              setDraftContent(value);
              setDraftDirty(true);
            }}
            autosize={{ minRows: 24, maxRows: 36 }}
            style={{ fontFamily: 'var(--semi-font-family-code, monospace)' }}
          />
        </Spin>
      </SideSheet>
    </div>
  );
}
