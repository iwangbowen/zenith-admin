/** 我的评论：CMS 内容评论列表（含审核状态，可删除、跳转内容页） */
import { useState } from 'react';
import { Button, Empty, Modal, Pagination, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { ExternalLink, Trash2 } from 'lucide-react';
import { CMS_COMMENT_STATUS_LABELS } from '@zenith/shared';
import type { CmsCommentStatus } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { useMyCmsComments, useDeleteMyCmsComment } from '../../hooks/queries';

const STATUS_COLORS: Record<CmsCommentStatus, 'orange' | 'green' | 'red'> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

export default function MyCommentsPage() {
  const [page, setPage] = useState(1);
  const listQuery = useMyCmsComments({ page, pageSize: 10 });
  const deleteMutation = useDeleteMyCmsComment();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleDelete(id: number) {
    Modal.confirm({
      title: '删除评论',
      content: '删除后不可恢复，确定删除这条评论吗？',
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('已删除');
      },
    });
  }

  return (
    <MemberPage title="我的评论">
      {listQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty title="暂无评论" description="在前台内容页发表评论后即可在这里管理" style={{ padding: 40 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((item) => (
            <div
              key={item.id}
              style={{
                padding: 12,
                background: 'var(--semi-color-bg-1)', borderRadius: 10, border: '1px solid var(--semi-color-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag size="small" color={STATUS_COLORS[item.status]}>{CMS_COMMENT_STATUS_LABELS[item.status]}</Tag>
                <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.contentTitle ?? '内容已删除'}
                </span>
                {item.contentUrl ? (
                  <Button size="small" theme="borderless" icon={<ExternalLink size={14} />} onClick={() => window.open(item.contentUrl!, '_blank')} />
                ) : null}
                <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => handleDelete(item.id)} />
              </div>
              <p style={{ margin: '8px 0 4px', fontSize: 14, lineHeight: 1.6 }}>{item.content}</p>
              <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                {item.createdAt}{item.likeCount > 0 ? ` · 获赞 ${item.likeCount}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {total > 10 ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination total={total} pageSize={10} currentPage={page} onPageChange={setPage} />
        </div>
      ) : null}
    </MemberPage>
  );
}
