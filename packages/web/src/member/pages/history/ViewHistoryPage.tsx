/** 浏览历史：CMS 内容浏览记录（最近浏览优先，可清空） */
import { useState } from 'react';
import { Button, Empty, Modal, Pagination, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { ExternalLink, Trash2 } from 'lucide-react';
import { CMS_CONTENT_TYPE_LABELS } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { useMyCmsViewHistory, useClearCmsViewHistory } from '../../hooks/queries';

export default function ViewHistoryPage() {
  const [page, setPage] = useState(1);
  const listQuery = useMyCmsViewHistory({ page, pageSize: 10 });
  const clearMutation = useClearCmsViewHistory();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleClear() {
    Modal.confirm({
      title: '清空浏览历史',
      content: '确定清空全部浏览记录吗？',
      okText: '清空',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await clearMutation.mutateAsync();
        setPage(1);
        Toast.success('已清空');
      },
    });
  }

  return (
    <MemberPage
      title="浏览历史"
      rightSlot={total > 0 ? (
        <Button theme="light" type="danger" icon={<Trash2 size={14} />} onClick={handleClear}>清空</Button>
      ) : undefined}
    >
      {listQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty title="暂无浏览记录" description="登录后浏览前台内容会自动记录（保留最近 100 条）" style={{ padding: 40 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((item) => (
            <div
              key={item.contentId}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                background: 'var(--semi-color-bg-1)', borderRadius: 10, border: '1px solid var(--semi-color-border)',
              }}
            >
              {item.coverThumb ? (
                <img src={item.coverThumb} alt="" style={{ width: 88, height: 60, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              ) : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {item.contentType !== 'article' ? <Tag size="small">{CMS_CONTENT_TYPE_LABELS[item.contentType]}</Tag> : null}
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>
                  最近浏览 {item.updatedAt ?? item.createdAt}{item.viewCount && item.viewCount > 1 ? ` · 共 ${item.viewCount} 次` : ''}
                </div>
              </div>
              {item.url ? (
                <Button size="small" theme="borderless" icon={<ExternalLink size={14} />} onClick={() => window.open(item.url!, '_blank')}>查看</Button>
              ) : (
                <Tag size="small">已下线</Tag>
              )}
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
