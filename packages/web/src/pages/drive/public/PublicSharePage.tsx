import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Breadcrumb, Button, Empty, Input, Spin, Table, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download, FolderInput, HardDrive, Lock } from 'lucide-react';
import { TOKEN_KEY, formatBytes } from '@zenith/shared/core';
import { DRIVE_SHARE_PERMISSION_LABELS, type DrivePublicNode, type DrivePublicShareMeta } from '@zenith/shared/drive';
import type { ManagedFile } from '@zenith/shared/platform';
import { ApiError } from '@/lib/query';
import { config } from '@/config';
import { FileNameCell } from '@/components/FileNameCell';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { useFilePreview } from '@/hooks/useFilePreview';
import { accessDrivePublicShare, drivePublicContentUrl, useDrivePublicChildren, useDrivePublicShare, useSaveFromDriveShare } from '@/hooks/queries/drive';
import { canPreviewFile } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DriveFolderPicker, type FolderTarget } from '../components/DriveFolderPicker';
import '../drive.css';

const SESSION_KEY = (token: string) => `drive.share.${token}`;

function publicNodeToManagedFile(node: DrivePublicNode, url: string): ManagedFile {
  return {
    id: String(node.id), storageConfigId: 0, storageName: '', provider: 'local', originalName: node.name, objectKey: '',
    size: node.size, mimeType: node.mimeType ?? undefined, extension: node.extension ?? undefined, visibility: 'restricted',
    url, createdAt: node.updatedAt, updatedAt: node.updatedAt,
  };
}

async function fetchPublicBlob(url: string): Promise<Blob> {
  const res = await fetch(`${config.apiBaseUrl}${url}`, { credentials: 'omit' });
  if (!res.ok) {
    let message = '下载失败';
    try { message = ((await res.json()) as { message?: string }).message ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.blob();
}

export default function PublicSharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [session, setSession] = useState<string | null>(() => (token ? sessionStorage.getItem(SESSION_KEY(token)) : null));
  const [meta, setMeta] = useState<DrivePublicShareMeta | null>(null);
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<number | undefined>(undefined);
  const [crumbs, setCrumbs] = useState<Array<{ id: number; name: string }>>([]);
  const [saving, setSaving] = useState<DrivePublicNode[] | null>(null);
  const isLoggedIn = !!localStorage.getItem(TOKEN_KEY);

  const metaQuery = useDrivePublicShare(token || undefined, session);
  useEffect(() => {
    if (metaQuery.data) setMeta(metaQuery.data);
  }, [metaQuery.data]);
  // 会话失效（401）→ 清除本地会话回到密码门；其他错误为致命
  useEffect(() => {
    const err = metaQuery.error;
    if (!err) return;
    if (err instanceof ApiError && err.code === 401 && session) {
      sessionStorage.removeItem(SESSION_KEY(token));
      setSession(null);
      return;
    }
    setFatal(err.message);
  }, [metaQuery.error, session, token]);

  // 无密码外链自动换取会话
  useEffect(() => {
    if (!meta || session || meta.requirePassword || verifying || fatal) return;
    void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, session, fatal]);

  const unlock = async (pwd?: string) => {
    setVerifying(true);
    try {
      const result = await accessDrivePublicShare(token, pwd);
      sessionStorage.setItem(SESSION_KEY(token), result.session);
      setSession(result.session);
      setMeta(result.meta);
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 401) Toast.error('访问密码错误');
      else setFatal(err instanceof Error ? err.message : '链接不存在或已失效');
    } finally {
      setVerifying(false);
    }
  };

  const root = meta?.node ?? null;
  const isFolder = root?.type === 'folder';
  const childrenQuery = useDrivePublicChildren(isFolder ? token : undefined, session, folderId ?? root?.id);
  const rows = useMemo(() => (isFolder ? (childrenQuery.data ?? []) : root ? [root] : []), [childrenQuery.data, isFolder, root]);
  const canDownload = meta?.permission === 'download';

  const preview = useFilePreview(() => rows.filter((n) => n.type === 'file' && session).map((n) => publicNodeToManagedFile(n, drivePublicContentUrl(token, n.id, session!))));
  const openNode = (node: DrivePublicNode) => {
    if (!session) return;
    if (node.type === 'folder') { setFolderId(node.id); setCrumbs((c) => [...c, { id: node.id, name: node.name }]); return; }
    if (canPreviewFile(node.mimeType, node.name)) void preview.handlePreview(publicNodeToManagedFile(node, drivePublicContentUrl(token, node.id, session)));
    else if (canDownload) void download(node);
    else Toast.info('该文件类型不支持在线预览，且此外链不允许下载');
  };
  const download = async (node: DrivePublicNode) => {
    if (!session) return;
    try {
      downloadBlob(await fetchPublicBlob(drivePublicContentUrl(token, node.id, session, true)), node.name);
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '下载失败');
    }
  };
  const save = useSaveFromDriveShare();
  const handleSave = async (target: FolderTarget) => {
    if (!session || !saving) return;
    await save.mutateAsync({ params: { token }, body: { targetSpaceId: target.spaceId, targetParentId: target.parentId, nodeIds: saving.map((n) => n.id) }, session });
    Toast.success(`已转存到「${target.label}」`);
    setSaving(null);
  };

  const columns: ColumnProps<DrivePublicNode>[] = [
    { title: '名称', dataIndex: 'name', ellipsis: { showTitle: false },
      render: (_: unknown, n: DrivePublicNode) => <FileNameCell name={n.name} mimeType={n.type === 'folder' ? 'inode/directory' : n.mimeType} onClick={() => openNode(n)} /> },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number, n: DrivePublicNode) => (n.type === 'folder' ? EMPTY_PLACEHOLDER : formatBytes(v)) },
    { title: '修改时间', dataIndex: 'updatedAt', width: 160, render: (v: string) => formatDateTime(v) },
    { title: '操作', width: canDownload && isLoggedIn ? 220 : 150, render: (_: unknown, n: DrivePublicNode) => (
      <div style={{ display: 'flex', gap: 4 }}>
        {n.type === 'file' && canPreviewFile(n.mimeType, n.name) && <Button size="small" theme="borderless" onClick={() => openNode(n)}>预览</Button>}
        {n.type === 'file' && canDownload && <Button size="small" theme="borderless" icon={<Download size={14} />} onClick={() => void download(n)}>下载</Button>}
        {canDownload && isLoggedIn && <Button size="small" theme="borderless" icon={<FolderInput size={14} />} onClick={() => setSaving([n])}>转存</Button>}
      </div>
    ) },
  ];

  let body;
  if (fatal) {
    body = <div className="drive-public__gate"><Empty title="链接不可用" description={fatal} /></div>;
  } else if (!meta) {
    body = <div className="drive-public__gate"><Spin size="large" /></div>;
  } else if (!session) {
    body = (
      <div className="drive-public__gate">
        <Lock size={40} color="var(--semi-color-text-2)" />
        <Typography.Title heading={5} style={{ margin: 0 }}>此分享需要访问密码</Typography.Title>
        <Typography.Text type="tertiary">{meta.sharerName ? `${meta.sharerName} 分享` : '匿名分享'}{meta.expireAt ? ` · ${formatDateTime(meta.expireAt)} 到期` : ''}</Typography.Text>
        <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 360 }}>
          <Input mode="password" value={password} onChange={setPassword} placeholder="输入访问密码" onEnterPress={() => void unlock(password)} autoFocus aria-label="访问密码" />
          <Button theme="solid" loading={verifying} disabled={!password} onClick={() => void unlock(password)}>访问</Button>
        </div>
      </div>
    );
  } else if (!root) {
    body = <div className="drive-public__gate"><Spin /></div>;
  } else {
    body = (
      <div className="drive-public__body">
        {isFolder && (
          <Breadcrumb style={{ marginBottom: 8 }}>
            <Breadcrumb.Item onClick={() => { setFolderId(undefined); setCrumbs([]); }}>{root.name}</Breadcrumb.Item>
            {crumbs.map((c, idx) => (
              <Breadcrumb.Item key={c.id} onClick={idx < crumbs.length - 1 ? () => { setFolderId(c.id); setCrumbs(crumbs.slice(0, idx + 1)); } : undefined}>{c.name}</Breadcrumb.Item>
            ))}
          </Breadcrumb>
        )}
        <Table<DrivePublicNode> size="small" rowKey="id" columns={columns} dataSource={rows} loading={childrenQuery.isFetching} pagination={false}
          empty={<Empty description="空文件夹" />} />
      </div>
    );
  }

  return (
    <div className="drive-public">
      <div className="drive-public__card">
        <div className="drive-public__head">
          <div className="drive-public__title">
            <HardDrive size={20} color="var(--semi-color-primary)" />
            <div style={{ minWidth: 0 }}>
              <Typography.Title heading={5} style={{ margin: 0 }} ellipsis={{ showTooltip: true }}>{root?.name ?? '文件分享'}</Typography.Title>
              {meta && (
                <Typography.Text type="tertiary" size="small">
                  {meta.sharerName ? `${meta.sharerName} 分享` : '匿名分享'} · {DRIVE_SHARE_PERMISSION_LABELS[meta.permission]}{meta.expireAt ? ` · ${formatDateTime(meta.expireAt)} 到期` : ' · 长期有效'}
                </Typography.Text>
              )}
            </div>
          </div>
          {root && session && (
            <div style={{ display: 'flex', gap: 8 }}>
              {canDownload && root.type === 'file' && <Button theme="solid" icon={<Download size={14} />} onClick={() => void download(root)}>下载</Button>}
              {canDownload && isLoggedIn && <Button icon={<FolderInput size={14} />} onClick={() => setSaving([root])}>转存到我的网盘</Button>}
            </div>
          )}
        </div>
        {body}
      </div>
      <FilePreviewLayer preview={preview} />
      <DriveFolderPicker visible={!!saving} title="转存到" okText="转存" loading={save.isPending} onCancel={() => setSaving(null)} onOk={(t) => void handleSave(t)} />
    </div>
  );
}
