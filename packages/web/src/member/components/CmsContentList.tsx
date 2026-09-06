import type { ReactNode } from 'react';
import { Button, Empty, Pagination, Spin, Tag } from '@douyinfe/semi-ui';
import { ExternalLink } from 'lucide-react';
import { CMS_CONTENT_TYPE_LABELS, type CmsContentType } from '@zenith/shared/cms';

export interface CmsContentListItem {
  contentId: number;
  coverThumb?: string | null;
  contentType: CmsContentType;
  title: string;
  url?: string | null;
}

export function CmsContentCardList<T extends CmsContentListItem>({
  items,
  meta,
  extra,
}: {
  items: T[];
  meta: (item: T) => ReactNode;
  extra?: (item: T) => ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((item) => (
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
            <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>{meta(item)}</div>
          </div>
          {item.url ? (
            <Button size="small" theme="borderless" icon={<ExternalLink size={14} />} onClick={() => window.open(item.url!, '_blank')}>查看</Button>
          ) : (
            <Tag size="small">已下线</Tag>
          )}
          {extra?.(item)}
        </div>
      ))}
    </div>
  );
}

export function CmsContentPagedList<T extends CmsContentListItem>({
  loading,
  items,
  total,
  page,
  pageSize = 10,
  onPageChange,
  emptyTitle,
  emptyDescription,
  meta,
  extra,
}: {
  loading: boolean;
  items: T[];
  total: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  emptyTitle: string;
  emptyDescription: string;
  meta: (item: T) => ReactNode;
  extra?: (item: T) => ReactNode;
}) {
  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  if (items.length === 0) return <Empty title={emptyTitle} description={emptyDescription} style={{ padding: 40 }} />;
  return (
    <>
      <CmsContentCardList items={items} meta={meta} extra={extra} />
      {total > pageSize ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination total={total} pageSize={pageSize} currentPage={page} onPageChange={onPageChange} />
        </div>
      ) : null}
    </>
  );
}
