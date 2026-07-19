/** 我的投稿：列表 + 状态筛选 + 写投稿入口（CMS 会员投稿） */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Modal, Pagination, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { PenLine, Trash2, Pencil } from 'lucide-react';
import type { CmsContentStatus } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { useMyContributions, useDeleteContribution } from '../../hooks/queries';

const STATUS_META: Record<CmsContentStatus, { label: string; color: 'grey' | 'orange' | 'green' | 'red' | 'blue' }> = {
  draft: { label: '草稿', color: 'grey' },
  pending: { label: '审核中', color: 'orange' },
  published: { label: '已发布', color: 'green' },
  offline: { label: '已下线', color: 'grey' },
  rejected: { label: '已驳回', color: 'red' },
};

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'pending', label: '审核中' },
  { value: 'published', label: '已发布' },
  { value: 'rejected', label: '已驳回' },
];

export default function ContributionsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const listQuery = useMyContributions({ page, pageSize: 10, ...(status ? { status } : {}) });
  const deleteMutation = useDeleteContribution();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleDelete(id: number) {
    Modal.confirm({
      title: '删除投稿',
      content: '确定删除该投稿吗？删除后不可恢复。',
      okText: '删除',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await deleteMutation.mutateAsync(id);
        Toast.success('已删除');
      },
    });
  }

  return (
    <MemberPage
      title="我的投稿"
      rightSlot={(
        <Button theme="solid" icon={<PenLine size={14} />} onClick={() => navigate('/contributions/edit')}>
          写投稿
        </Button>
      )}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="small"
            theme={status === f.value ? 'solid' : 'light'}
            onClick={() => { setStatus(f.value); setPage(1); }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty title="暂无投稿" description="点击右上角「写投稿」发布你的第一篇内容" style={{ padding: 40 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((item) => {
            const meta = STATUS_META[item.status];
            const editable = item.status === 'draft' || item.status === 'rejected';
            return (
              <div
                key={item.id}
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  border: '1px solid var(--m-border)',
                  padding: '14px 18px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Tag size="small" color={meta.color}>{meta.label}</Tag>
                  <span style={{ fontSize: 15, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                </div>
                {item.summary ? (
                  <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {item.summary}
                  </div>
                ) : null}
                {item.status === 'rejected' && item.rejectReason ? (
                  <div style={{ fontSize: 13, color: 'var(--m-danger, #fa5151)', marginBottom: 6 }}>
                    驳回原因：{item.rejectReason}
                  </div>
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--m-text-secondary)' }}>
                  <span>{item.channelName ?? '—'}</span>
                  <span>{item.createdAt}</span>
                  {item.status === 'published' ? <span>{item.viewCount} 阅读</span> : null}
                  <span style={{ flex: 1 }} />
                  {editable ? (
                    <>
                      <Button size="small" theme="borderless" icon={<Pencil size={13} />} onClick={() => navigate(`/contributions/edit?id=${item.id}`)}>
                        修改
                      </Button>
                      <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={13} />} onClick={() => handleDelete(item.id)}>
                        删除
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
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
