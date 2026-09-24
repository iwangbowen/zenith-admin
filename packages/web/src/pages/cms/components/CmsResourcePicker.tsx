import { Button, Empty, Pagination, Space, Spin, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import { FileText, UploadCloud } from 'lucide-react';
import type { CmsResource, CmsResourceType } from '@zenith/shared/cms';
import { formatBytes } from '@zenith/shared/core';
import { AppModal } from '@/components/AppModal';
import { KeywordInput } from '@/components/search-filters';
import { SearchButton } from '@/components/toolbar-controls';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { cmsResourceKeys, useCmsResourceList, useUploadCmsResource } from '@/hooks/queries/cms-resources';
import './cms-assets.css';

export const CMS_ASSET_LABELS: Record<CmsResourceType, string> = { image: '图片', audio: '音频', video: '视频', document: '文档', other: '文件' };
export const cmsResourceAccept = (type?: CmsResourceType) => type === 'image' || type === 'audio' || type === 'video' ? `${type}/*` : undefined;

export function CmsResourcePreview({ resource, onDuration }: Readonly<{ resource: Pick<CmsResource, 'type' | 'url' | 'thumbUrl' | 'name'>; onDuration?: (seconds: number) => void }>) {
  if (resource.type === 'image') return <img className="cms-asset-preview__image" src={resource.thumbUrl ?? resource.url} alt={resource.name} loading="lazy" />;
  if (resource.type === 'audio') return <audio key={resource.url} aria-label={`预览${resource.name}`} controls preload="metadata" src={resource.url} onLoadedMetadata={(event) => onDuration?.(event.currentTarget.duration)} />;
  if (resource.type === 'video') return <video key={resource.url} aria-label={`预览${resource.name}`} controls preload="metadata" src={resource.url} onLoadedMetadata={(event) => onDuration?.(event.currentTarget.duration)} />;
  return <FileText size={36} aria-hidden />;
}

export function CmsResourcePicker({ siteId, visible, type, title, disabled = false, allowUpload = true, onCancel, onSelect }: Readonly<{
  siteId?: number;
  visible: boolean;
  type?: CmsResourceType;
  title?: string;
  disabled?: boolean;
  allowUpload?: boolean;
  onCancel: () => void;
  onSelect: (resource: CmsResource) => void;
}>) {
  const { hasPermission } = usePermission();
  const canRead = hasPermission('cms:resource:list');
  const canUpload = allowUpload && hasPermission('cms:resource:upload');
  const search = useListSearch({ defaults: { keyword: '' }, listKey: cmsResourceKeys.lists, pageSize: 12, resetKey: [siteId, type] });
  const filter = useFilterQuery({ keyword: search.submittedParams.keyword.trim(), type });
  const query = useCmsResourceList({ siteId: siteId ?? 0, page: search.page, pageSize: 12, ...filter }, visible && siteId !== undefined && canRead);
  const upload = useUploadCmsResource();
  const resources = (query.data?.list ?? []).filter((resource) => resource.siteId === siteId && (!type || resource.type === type));
  const choose = (resource: CmsResource) => {
    if (disabled || resource.siteId !== siteId || (type && resource.type !== type)) return;
    onSelect(resource);
  };
  return <AppModal title={title ?? `本站${type ? CMS_ASSET_LABELS[type] : ''}素材库`} visible={visible} onCancel={onCancel} footer={null} width={800}>
    <Space wrap className="cms-resource-picker__toolbar">
      <KeywordInput {...search.bindKeyword('keyword')} placeholder="搜索素材名称" width="auto" disabled={!siteId || !canRead} />
      <SearchButton onClick={search.handleSearch} disabled={!siteId || !canRead} />
      {canUpload ? <Upload action="" accept={cmsResourceAccept(type)} limit={1} showUploadList={false} disabled={!siteId || disabled}
        customRequest={async ({ fileInstance, onSuccess, onError }) => {
          if (!siteId || disabled) return;
          try {
            const resource = await upload.mutateAsync({ siteId, file: fileInstance });
            if (type && resource.type !== type) { Toast.warning(`请选择${CMS_ASSET_LABELS[type]}文件`); onError?.({ status: 0 }); return; }
            onSuccess?.({});
            Toast.success('素材已上传');
            choose(resource);
          } catch { onError?.({ status: 0 }); }
        }}><Button icon={<UploadCloud size={14} />} loading={upload.isPending} disabled={!siteId || disabled}>上传{type ? CMS_ASSET_LABELS[type] : '素材'}</Button></Upload> : null}
    </Space>
    {!siteId ? <Empty description="请先确定所属站点" /> : !canRead ? <Empty description="没有查看本站素材的权限" /> : query.isError ? <Empty description="素材加载失败"><Button onClick={() => void query.refetch()}>重试</Button></Empty> : <Spin spinning={query.isFetching}>
      <div className="cms-resource-picker__grid">
        {resources.map((resource) => <article key={resource.id} className="cms-resource-picker__item">
          <div className="cms-resource-picker__preview"><CmsResourcePreview resource={resource} /></div>
          <Typography.Text ellipsis={{ showTooltip: true }} className="cms-resource-picker__name">{resource.name}</Typography.Text>
          <Typography.Text size="small" type="tertiary">{CMS_ASSET_LABELS[resource.type]} · {formatBytes(resource.size)}</Typography.Text>
          <Button block disabled={disabled || resource.siteId !== siteId || Boolean(type && resource.type !== type)} onClick={() => choose(resource)} aria-label={`选择${resource.name}`}>选择</Button>
        </article>)}
      </div>
      {!query.isFetching && !resources.length ? <Empty description="暂无符合条件的本站素材" /> : null}
    </Spin>}
    <Pagination className="cms-resource-picker__pagination" total={query.data?.total ?? 0} currentPage={search.page} pageSize={12} onPageChange={search.setPage} />
  </AppModal>;
}

export default CmsResourcePicker;
