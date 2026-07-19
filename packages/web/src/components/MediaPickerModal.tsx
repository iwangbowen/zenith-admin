import { useState } from 'react';
import { Button, Empty, Input, Pagination, Spin, Upload, Toast } from '@douyinfe/semi-ui';
import { FileText, Search, UploadCloud } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { useFileList, useUploadFile } from '@/hooks/queries/files';
import type { ManagedFile } from '@zenith/shared';

export interface MediaPickerModalProps {
  visible: boolean;
  onCancel: () => void;
  /** 选中文件后回调（url 为稳定代理路径 /api/files/{id}/content） */
  onSelect: (file: ManagedFile) => void;
  /** 仅展示图片（默认 true；false 时展示全部文件类型） */
  imageOnly?: boolean;
  title?: string;
}

const PAGE_SIZE = 12;

/**
 * 媒体库选择器：从文件中心（managed_files）挑选已有文件，支持关键词搜索与就地上传。
 * 用于 CMS 封面图、模型 image/file 字段、广告图等需要复用媒资的场景。
 */
export function MediaPickerModal({ visible, onCancel, onSelect, imageOnly = true, title = '媒体库' }: Readonly<MediaPickerModalProps>) {
  const [page, setPage] = useState(1);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [keyword, setKeyword] = useState('');

  const listQuery = useFileList({
    page,
    pageSize: PAGE_SIZE,
    keyword: keyword || undefined,
    fileType: imageOnly ? 'image' : undefined,
  });
  const uploadMutation = useUploadFile();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  function handleSearch() {
    setPage(1);
    setKeyword(draftKeyword.trim());
  }

  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      closeOnEsc
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索文件名"
          value={draftKeyword}
          onChange={setDraftKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Upload
          action=""
          accept={imageOnly ? 'image/*' : undefined}
          limit={1}
          showUploadList={false}
          customRequest={async ({ fileInstance, onSuccess, onError }) => {
            try {
              const formData = new FormData();
              formData.append('file', fileInstance);
              const uploaded = await uploadMutation.mutateAsync({ formData });
              Toast.success('上传成功');
              onSuccess?.({});
              onSelect(uploaded);
            } catch {
              onError?.({ status: 0 });
            }
          }}
        >
          <Button icon={<UploadCloud size={14} />} loading={uploadMutation.isPending}>上传新文件</Button>
        </Upload>
      </div>

      <Spin spinning={listQuery.isFetching}>
        {list.length === 0 ? (
          <Empty description="暂无文件" style={{ padding: '48px 0' }} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 12,
              minHeight: 200,
            }}
          >
            {list.map((file) => {
              const isImage = file.mimeType?.startsWith('image/');
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onSelect(file)}
                  title={file.originalName}
                  style={{
                    cursor: 'pointer',
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 'var(--semi-border-radius-medium)',
                    padding: 0,
                    background: 'var(--semi-color-bg-1)',
                    overflow: 'hidden',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--semi-color-fill-0)' }}>
                    {isImage ? (
                      <img src={file.url} alt={file.originalName} loading="lazy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <FileText size={32} color="var(--semi-color-text-2)" />
                    )}
                  </div>
                  <div style={{ padding: '6px 8px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.originalName}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Spin>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} onPageChange={setPage} size="small" />
      </div>
    </AppModal>
  );
}

export default MediaPickerModal;
