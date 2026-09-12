import { useMemo } from 'react';
import { Button, Empty, Pagination, Spin, Upload, Toast } from '@douyinfe/semi-ui';
import { FileText, UploadCloud } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { fileKeys, useFileList, useUploadFile } from '@/hooks/queries/files';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import type { ManagedFile } from '@zenith/shared/platform';
import { SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';

export interface MediaPickerModalProps {
  visible: boolean;
  onCancel: () => void;
  /** 选中文件后回调（url 为稳定代理路径，见 `fileContract.content`） */
  onSelect: (file: ManagedFile) => void;
  /** 仅展示图片（默认 true；false 时展示全部文件类型） */
  imageOnly?: boolean;
  title?: string;
}

const PAGE_SIZE = 12;

interface MediaSearchParams {
  keyword: string;
}

const defaultMediaSearch: MediaSearchParams = { keyword: '' };

/**
 * 媒体库选择器：从文件中心（managed_files）挑选已有文件，支持关键词搜索与就地上传。
 * 用于 CMS 封面图、模型 image/file 字段、广告图等需要复用媒资的场景。
 */
export function MediaPickerModal({ visible, onCancel, onSelect, imageOnly = true, title = '媒体库' }: Readonly<MediaPickerModalProps>) {
  // 选择器固定 12 条 / 页；关键字经「查询」/ 回车提交并回源
  const { page, setPage, bindKeyword, submittedParams, handleSearch } = useListSearch<MediaSearchParams>({
    defaults: defaultMediaSearch,
    listKey: fileKeys.lists,
    pageSize: PAGE_SIZE,
  });
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword.trim(),
    fileType: imageOnly ? 'image' as const : undefined,
  }), [submittedParams, imageOnly]);

  const listQuery = useFileList({ page, pageSize: PAGE_SIZE, ...filterQuery });
  const uploadMutation = useUploadFile();

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

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
        {/* 弹窗内的搜索框跟随剩余宽度自适应 */}
        <KeywordInput placeholder="搜索文件名" {...bindKeyword('keyword')} width="auto" style={{ flex: 1 }} />
        <SearchButton onClick={handleSearch} />
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
              // 多文件上传接口返回数组；此处每次只传一个文件
              onSelect(uploaded[0]);
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
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
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
                    background: 'var(--surface-card)',
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
