import { useState } from 'react';
import { Button, Empty, Input, List, Space, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { DRIVE_ACTIVITY_ACTION_LABELS, type DriveNode, type DriveNodeComment } from '@zenith/shared/drive';
import { ListPagination } from '@/components/ListPagination';
import { useCreateDriveNodeComment, useDeleteDriveNodeComment, useDriveNodeActivities, useDriveNodeComments } from '@/hooks/queries/drive';
import { useAuth } from '@/hooks/useAuth';
import { usePagination } from '@/hooks/usePagination';
import { confirmDelete } from '@/utils/confirm';
import { describeActivityDetail as describeDetail, roleAtLeast } from '../drive-utils';
import UserSelect from '@/components/UserSelect';
import { useEditDriveComment } from '@/hooks/queries/drive-collaboration';

export function DriveActivityPanel({ node }: { readonly node: DriveNode }) {
  const { page, pageSize, buildPagination } = usePagination(20);
  const query = useDriveNodeActivities(node.id, { page, pageSize });
  const list = query.data?.list ?? [];
  if (!query.isPending && list.length === 0) return <Empty description="暂无动态" />;
  return (
    <div className="drive-panel">
      <Timeline mode="left">
        {list.map((a) => (
          <Timeline.Item key={a.id} time={a.createdAt} type={a.action === 'delete' || a.action === 'purge' ? 'warning' : 'default'}>
            <Typography.Text strong>{a.actorName ?? '匿名访客'}</Typography.Text>
            <Typography.Text> {DRIVE_ACTIVITY_ACTION_LABELS[a.action]}</Typography.Text>
            {describeDetail(a.detail) && <Typography.Text type="tertiary" size="small">（{describeDetail(a.detail)}）</Typography.Text>}
          </Timeline.Item>
        ))}
      </Timeline>
      {(query.data?.total ?? 0) > pageSize && <ListPagination pagination={buildPagination(query.data?.total ?? 0)} />}
    </div>
  );
}

export function DriveCommentsPanel({ node }: { readonly node: DriveNode }) {
  const { user } = useAuth();
  const query = useDriveNodeComments(node.id);
  const create = useCreateDriveNodeComment();
  const remove = useDeleteDriveNodeComment();
  const update = useEditDriveComment(node.spaceId);
  const [content, setContent] = useState('');
  const [mentions, setMentions] = useState<number[]>([]);
  const [editing, setEditing] = useState<DriveNodeComment | null>(null);
  const canManage = roleAtLeast(node.myRole, 'manager');

  const submit = async () => {
    const text = content.trim();
    if (!text) return;
    if (editing) await update.mutateAsync({ params: { id: node.id, commentId: editing.id }, body: { content: text, mentionUserIds: mentions } });
    else await create.mutateAsync({ params: { id: node.id }, body: { content: text, parentId: null, mentionUserIds: mentions } });
    setContent('');
    setMentions([]);
    setEditing(null);
    Toast.success(editing ? '评论已更新' : '已评论');
  };

  return (
    <div className="drive-panel">
      <List
        dataSource={query.data ?? []}
        loading={query.isPending}
        emptyContent={<Empty description="还没有评论" />}
        renderItem={(c) => (
          <List.Item
            key={c.id}
            main={(
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <Typography.Text strong>{c.authorName ?? '未知用户'}</Typography.Text>
                  <Typography.Text type="tertiary" size="small">{c.createdAt}</Typography.Text>
                  {c.updatedAt !== c.createdAt && <Typography.Text type="tertiary" size="small">已编辑</Typography.Text>}
                </div>
                <Typography.Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{c.content}</Typography.Paragraph>
              </div>
            )}
            extra={(c.authorId === user?.id || canManage) ? (
              <Space>
              <Button size="small" theme="borderless" icon={<Pencil size={14} />} aria-label="编辑评论" onClick={() => { setEditing(c); setContent(c.content); setMentions(c.mentionUserIds ?? []); }} />
              <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} aria-label="删除评论"
                onClick={() => confirmDelete({ title: '删除这条评论？', onOk: () => remove.mutateAsync({ params: { id: node.id, commentId: c.id } }) })} />
              </Space>
            ) : undefined}
          />
        )}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input value={content} onChange={setContent} placeholder="写下评论…" maxLength={2000} onEnterPress={() => void submit()} />
        <Button theme="solid" icon={<Send size={14} />} loading={create.isPending || update.isPending} disabled={!content.trim()} onClick={() => void submit()}>{editing ? '保存' : '发送'}</Button>
      </div>
      <Space style={{ marginTop: 8, width: '100%' }}>
        <UserSelect multiple value={mentions} onChange={(value) => setMentions(Array.isArray(value) ? value : [])} placeholder="@ 提及有文件权限的用户" />
        {editing && <Button theme="borderless" onClick={() => { setEditing(null); setContent(''); setMentions([]); }}>取消编辑</Button>}
      </Space>
    </div>
  );
}
