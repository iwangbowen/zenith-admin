/** 我的收藏：CMS 内容收藏列表（点击跳前台详情，可取消收藏） */
import { useState } from 'react';
import { Button, Empty, Modal, Pagination, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { ExternalLink, Trash2 } from 'lucide-react';
import { CMS_CONTENT_TYPE_LABELS } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { useMyCmsFavorites, useRemoveCmsFavorite } from '../../hooks/queries';

export default function FavoritesPage() {
  const [page, setPage] = useState(1);
  const listQuery = useMyCmsFavorites({ page, pageSize: 10 });
  const removeMutation = useRemoveCmsFavorite();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleRemove(contentId: number, title: string) {
    Modal.confirm({
      title: '取消收藏',
      content: `确定取消收藏「${title}」吗？`,
      onOk: async () => {
        await removeMutation.mutateAsync(contentId);
        Toast.success('已取消收藏');
      },
    });
  }

  return (
    <MemberPage title="我的收藏">
      {listQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty title="暂无收藏" description="在前台内容页点击「收藏」即可同步到这里" style={{ padding: 40 }} />
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
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>收藏于 {item.createdAt}</div>
              </div>
              {item.url ? (
                <Button size="small" theme="borderless" icon={<ExternalLink size={14} />} onClick={() => window.open(item.url!, '_blank')}>查看</Button>
              ) : (
                <Tag size="small">已下线</Tag>
              )}
              <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => handleRemove(item.contentId, item.title)} />
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
