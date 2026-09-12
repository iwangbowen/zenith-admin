import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Breadcrumb, Button, Empty, Input, Progress, Spin, Table, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle2, Download, FolderInput, HardDrive, Inbox, Lock, UploadCloud } from 'lucide-react';
import { TOKEN_KEY, formatBytes } from '@zenith/shared/core';
import { describeShareCapabilities, type DrivePublicNode, type DrivePublicShareMeta, type DrivePublicUploadResult } from '@zenith/shared/drive';
import type { ManagedFile } from '@zenith/shared/platform';
import { ApiError } from '@/lib/query';
import { config } from '@/config';
import { FileNameCell } from '@/components/FileNameCell';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { useFilePreview } from '@/hooks/useFilePreview';
import { accessDrivePublicShare, drivePublicContentUrl, uploadToDriveCollect, useDrivePublicChildren, useDrivePublicShare, useSaveFromDriveShare } from '@/hooks/queries/drive';
import { canPreviewFile } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { DriveFolderPicker, type FolderTarget } from '../components/DriveFolderPicker';
import '../drive.css';

const SESSION_KEY = (token: string) => `drive.share.${token}`;

interface CollectItem {
  key: string;
  name: string;
  size: number;
  percent: number;
  status: 'uploading' | 'done' | 'error';
  message?: string;
  result?: DrivePublicUploadResult;
}

/** 文件收集：提交人信息 + 选择文件即上传，本次会话内的提交列表留在页面上 */
function CollectPanel({ token, session, meta, onUploaded }: {
  readonly token: string;
  readonly session: string;
  readonly meta: DrivePublicShareMeta;
  readonly onUploaded: () => void;
}) {
  const policy = meta.collectPolicy;
  const [submitterName, setSubmitterName] = useState('');
  const [submitterNote, setSubmitterNote] = useState('');
  const [items, setItems] = useState<CollectItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // 剩余名额以服务端为准（每次提交成功后父组件会重取 meta）
  const exhausted = meta.uploadsRemaining !== null && meta.uploadsRemaining <= 0;
  const needName = !!policy?.requireSubmitter && !submitterName.trim();

  const patch = (key: string, partial: Partial<CollectItem>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...partial } : i)));

  const submit = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (policy && file.size > policy.maxFileSizeMb * 1024 * 1024) {
        setItems((prev) => [{ key, name: file.name, size: file.size, percent: 0, status: 'error', message: `超过单文件上限 ${policy.maxFileSizeMb}MB` }, ...prev]);
        continue;
      }
      setItems((prev) => [{ key, name: file.name, size: file.size, percent: 0, status: 'uploading' }, ...prev]);
      try {
        const result = await uploadToDriveCollect(token, session, file, { submitterName: submitterName.trim(), submitterNote: submitterNote.trim() }, (percent) => patch(key, { percent }));
        patch(key, { status: 'done', percent: 100, result });
        onUploaded();
      } catch (err) {
        patch(key, { status: 'error', message: err instanceof Error ? err.message : '提交失败' });
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="drive-collect">
      <div className="drive-collect__rules">
        <Typography.Text type="tertiary" size="small">
          {policy ? `单文件 ≤ ${policy.maxFileSizeMb}MB` : ''}
          {policy?.allowedExtensions.length ? ` · 仅接受 ${policy.allowedExtensions.map((e) => `.${e}`).join(' ')}` : ' · 类型不限'}
          {meta.uploadsRemaining !== null ? ` · 还可提交 ${meta.uploadsRemaining} 个` : ''}
        </Typography.Text>
      </div>
      <div className="drive-collect__form">
        <Input value={submitterName} onChange={setSubmitterName} maxLength={50} placeholder={policy?.requireSubmitter ? '你的姓名（必填）' : '你的姓名（可选）'} aria-label="提交人姓名" />
        <TextArea value={submitterNote} onChange={setSubmitterNote} maxLength={200} rows={2} placeholder="备注（可选）：说明文件内容或版本" aria-label="备注" />
      </div>
      <input ref={inputRef} type="file" multiple hidden accept={policy?.allowedExtensions.length ? policy.allowedExtensions.map((e) => `.${e}`).join(',') : undefined} onChange={(e) => void submit(e.target.files)} />
      <Button theme="solid" size="large" block icon={<UploadCloud size={16} />} disabled={needName || exhausted} onClick={() => inputRef.current?.click()}>
        {exhausted ? '收集数量已达上限' : needName ? '请先填写姓名' : '选择文件并提交'}
      </Button>
      {items.length > 0 && (
        <ul className="drive-collect__list" aria-label="本次提交">
          {items.map((item) => (
            <li key={item.key} className={`drive-collect__item drive-collect__item--${item.status}`}>
              <div className="drive-collect__item-head">
                <Typography.Text ellipsis={{ showTooltip: true }} className="drive-collect__item-name">{item.result?.name ?? item.name}</Typography.Text>
                <span className="drive-nowrap">{formatBytes(item.size)}</span>
                {item.status === 'done' && <CheckCircle2 size={14} color="var(--semi-color-success)" aria-label="已提交" />}
              </div>
              {item.status === 'uploading' && <Progress percent={item.percent} size="small" aria-label={`${item.name} 上传进度`} />}
              {item.status === 'error' && <Typography.Text type="danger" size="small">{item.message}</Typography.Text>}
              {item.status === 'done' && item.result && <Typography.Text type="tertiary" size="small">已于 {item.result.submittedAt} 提交</Typography.Text>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  const canBrowse = meta?.capabilities.includes('preview') ?? false;
  const isCollect = meta?.kind === 'collect';
  const childrenQuery = useDrivePublicChildren(isFolder && canBrowse ? token : undefined, session, folderId ?? root?.id);
  const rows = useMemo(() => (isFolder ? (childrenQuery.data ?? []) : root ? [root] : []), [childrenQuery.data, isFolder, root]);
  const canDownload = meta?.capabilities.includes('download') ?? false;

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
  const save = useSaveFromDriveShare(session);
  const handleSave = async (target: FolderTarget) => {
    if (!session || !saving) return;
    await save.mutateAsync({ params: { token }, body: { targetSpaceId: target.spaceId, targetParentId: target.parentId, nodeIds: saving.map((n) => n.id) } });
    Toast.success(`已转存到「${target.label}」`);
    setSaving(null);
  };

  const columns: ColumnProps<DrivePublicNode>[] = [
    { title: '名称', dataIndex: 'name', ellipsis: { showTitle: false },
      render: (_: unknown, n: DrivePublicNode) => <FileNameCell name={n.name} mimeType={n.type === 'folder' ? 'inode/directory' : n.mimeType} onClick={() => openNode(n)} /> },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number, n: DrivePublicNode) => <span className="drive-nowrap">{n.type === 'folder' ? EMPTY_PLACEHOLDER : formatBytes(v)}</span> },
    dateTimeColumn<DrivePublicNode>('修改时间', 'updatedAt'),
    { title: '操作', width: canDownload && isLoggedIn ? 250 : 170, render: (_: unknown, n: DrivePublicNode) => (
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
        {isCollect && session && (
          <CollectPanel token={token} session={session} meta={meta} onUploaded={() => { void metaQuery.refetch(); if (canBrowse) void childrenQuery.refetch(); }} />
        )}
        {canBrowse && isFolder && (
          <Breadcrumb style={{ marginBottom: 8 }}>
            <Breadcrumb.Item onClick={() => { setFolderId(undefined); setCrumbs([]); }}>{root.name}</Breadcrumb.Item>
            {crumbs.map((c, idx) => (
              <Breadcrumb.Item key={c.id} onClick={idx < crumbs.length - 1 ? () => { setFolderId(c.id); setCrumbs(crumbs.slice(0, idx + 1)); } : undefined}>{c.name}</Breadcrumb.Item>
            ))}
          </Breadcrumb>
        )}
        {canBrowse && (
          <Table<DrivePublicNode> size="small" rowKey="id" columns={columns} dataSource={rows} loading={childrenQuery.isFetching} pagination={false}
            empty={<Empty description="空文件夹" />} />
        )}
      </div>
    );
  }

  const headIcon = isCollect ? <Inbox size={20} color="var(--semi-color-primary)" /> : <HardDrive size={20} color="var(--semi-color-primary)" />;
  const headTitle = root?.name ?? (isCollect ? '文件收集' : '文件分享');
  const headMeta = meta ? `${meta.sharerName ? `${meta.sharerName} ${isCollect ? '发起收集' : '分享'}` : isCollect ? '文件收集' : '匿名分享'} · ${describeShareCapabilities(meta.capabilities)}${meta.expireAt ? ` · ${formatDateTime(meta.expireAt)} 到期` : ' · 长期有效'}` : '';

  return (
    <div className="drive-public">
      <div className="drive-public__card">
        <div className="drive-public__head">
          <div className="drive-public__title">
            {headIcon}
            <div style={{ minWidth: 0 }}>
              <Typography.Title heading={5} style={{ margin: 0 }} ellipsis={{ showTooltip: true }}>{headTitle}</Typography.Title>
              {meta && <Typography.Text type="tertiary" size="small">{headMeta}</Typography.Text>}
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
      <FilePreviewLayer preview={preview} watermark={meta?.watermarkText} />
      <DriveFolderPicker visible={!!saving} title="转存到" okText="转存" loading={save.isPending} onCancel={() => setSaving(null)} onOk={(t) => void handleSave(t)} />
    </div>
  );
}
