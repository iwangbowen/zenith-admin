import { useState } from 'react';
import { Button, Empty, Input, List, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import { Send, Trash2 } from 'lucide-react';
import { DRIVE_ACTIVITY_ACTION_LABELS, type DriveNode } from '@zenith/shared/drive';
import { ListPagination } from '@/components/ListPagination';
import { useCreateDriveNodeComment, useDeleteDriveNodeComment, useDriveNodeActivities, useDriveNodeComments } from '@/hooks/queries/drive';
import { useAuth } from '@/hooks/useAuth';
import { usePagination } from '@/hooks/usePagination';
import { confirmDelete } from '@/utils/confirm';
import { describeActivityDetail as describeDetail, roleAtLeast } from '../drive-utils';

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
  const [content, setContent] = useState('');
  const canManage = roleAtLeast(node.myRole, 'manager');

  const submit = async () => {
    const text = content.trim();
    if (!text) return;
    await create.mutateAsync({ params: { id: node.id }, body: { content: text, parentId: null } });
    setContent('');
    Toast.success('已评论');
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
                </div>
                <Typography.Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{c.content}</Typography.Paragraph>
              </div>
            )}
            extra={(c.authorId === user?.id || canManage) ? (
              <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} aria-label="删除评论"
                onClick={() => confirmDelete({ title: '删除这条评论？', onOk: () => remove.mutateAsync({ params: { id: node.id, commentId: c.id } }) })} />
            ) : undefined}
          />
        )}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input value={content} onChange={setContent} placeholder="写下评论…" maxLength={2000} onEnterPress={() => void submit()} />
        <Button theme="solid" icon={<Send size={14} />} loading={create.isPending} disabled={!content.trim()} onClick={() => void submit()}>发送</Button>
      </div>
    </div>
  );
}
