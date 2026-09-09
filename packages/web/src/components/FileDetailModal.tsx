import type { ReactNode } from 'react';
import { Button, Descriptions, Space, Spin, Typography } from '@douyinfe/semi-ui';
import type { ManagedFile } from '@zenith/shared/platform';
import { formatBytes } from '@zenith/shared/core';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';

const { Text } = Typography;

interface FileDetailModalProps {
  visible: boolean;
  /** 当前展示的文件（详情查询结果优先，缺省回退列表行） */
  file: ManagedFile | null;
  /** 详情查询进行中 */
  loading: boolean;
  /** 访问链接口径（文件中心 directUrl 优先；存储浏览器统一走代理地址），与页面「复制链接」保持一致 */
  resolveUrl: (file: ManagedFile) => string;
  onCopyUrl: (file: ManagedFile) => void;
  onClose: () => void;
  /** 插在「文件大小」之后的附加行（如图片分辨率） */
  extraRows?: Array<{ key: string; value: ReactNode }>;
}

/** 托管文件详情弹窗：文件中心与存储服务文件浏览器共用 */
export function FileDetailModal({ visible, file, loading, resolveUrl, onCopyUrl, onClose, extraRows = [] }: Readonly<FileDetailModalProps>) {
  return (
    <AppModal
      title="文件详情"
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={() => file && onCopyUrl(file)}>复制链接</Button>
          <Button type="primary" onClick={onClose}>关闭</Button>
        </Space>
      }
      width={560}
    >
      <Spin spinning={loading} tip="加载中..." size="small">
        {file && (
          <Descriptions
            align="left"
            size="medium"
            data={[
              { key: '文件名', value: file.originalName },
              { key: '存储服务', value: file.storageName },
              { key: 'MIME 类型', value: file.mimeType || '—' },
              { key: '文件大小', value: formatBytes(file.size) },
              ...extraRows,
              { key: '上传人', value: file.uploaderName || '—' },
              { key: '对象键', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{file.objectKey}</Text> },
              { key: '访问链接', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{resolveUrl(file)}</Text> },
              { key: '上传时间', value: formatDateTime(file.createdAt) },
            ]}
          />
        )}
      </Spin>
    </AppModal>
  );
}

export default FileDetailModal;
