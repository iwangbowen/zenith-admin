import { useState, useCallback, useMemo } from 'react';
import {
  Upload,
  Button,
  Space,
  Typography,
  ImagePreview,
  Toast,
} from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import type { FileItem } from '@douyinfe/semi-ui/lib/es/upload';
import { Plus, Download, X, Eye } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import {
  getFileTypeIcon,
  canPreviewFile,
  fetchProtectedFile,
  formatFileSize,
} from '@/utils/file-utils';
import FilePreviewModal from '@/components/FilePreviewModal';

const { Text } = Typography;

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 附件项（与后端 AnnouncementAttachment 兼容） */
export interface AttachmentItem {
  id: number;
  fileId: number;
  file: {
    id: number;
    originalName: string;
    size: number;
    mimeType: string | null;
    extension: string | null;
    url: string;
  };
  sortOrder: number;
  createdAt: string;
}

/** 组件模式 */
export type AttachmentMode = 'edit' | 'view';

interface FileAttachmentProps {
  /** 当前附件列表 */
  value?: AttachmentItem[];
  /** 附件变化回调（edit 模式下） */
  onChange?: (items: AttachmentItem[]) => void;
  /** 模式：edit 可上传/删除，view 只读 */
  mode?: AttachmentMode;
  /** 最大上传数量，0 表示不限制 */
  limit?: number;
  /** 最大文件大小（MB），默认 50 */
  maxSizeMB?: number;
  /** 允许的文件类型，如 '.pdf,.doc,.docx' */
  accept?: string;
  /** 自定义标题 */
  title?: string;
  /** 是否显示标题 */
  showTitle?: boolean;
  /** 上传提示文本 */
  uploadTip?: string;
  /** 样式 */
  style?: CSSProperties;
  /** 是否禁用 */
  disabled?: boolean;
}

/** 将 AttachmentItem 转换为 Semi Upload FileItem */
function toUploadFileItem(item: AttachmentItem): FileItem {
  return {
    uid: `attach-${item.id}`,
    name: item.file.originalName,
    size: String(item.file.size),
    status: 'success' as const,
    url: item.file.url,
    // 自定义字段：保留原始附件数据
    ...(item as unknown as Record<string, unknown>),
  };
}

// ─── 组件实现 ────────────────────────────────────────────────────────────────

export default function FileAttachment({
  value = [],
  onChange,
  mode = 'view',
  limit = 0,
  maxSizeMB = 50,
  accept,
  title = '附件',
  showTitle = true,
  uploadTip,
  style,
  disabled = false,
}: FileAttachmentProps = {}) {
  const isEditMode = mode === 'edit' && !disabled;

  // 文件预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    name: string;
    mimeType: string | null;
  } | null>(null);

  // 图片预览
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const uploadAction = `${config.apiBaseUrl}/api/files/upload-one`;
  const uploadHeaders = useMemo(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  /** Semi Upload fileList */
  const uploadFileList = useMemo(
    () => value.map(toUploadFileItem),
    [value],
  );

  /** 从 FileItem 恢复 AttachmentItem */
  const toAttachmentItem = useCallback((fileItem: FileItem): AttachmentItem => {
    return fileItem as unknown as AttachmentItem;
  }, []);

  /** 下载文件 */
  const downloadFile = useCallback(async (item: AttachmentItem) => {
    try {
      const blob = await fetchProtectedFile(item.file.url);
      const objectUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = item.file.originalName;
      link.click();
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      Toast.error('下载文件失败');
    }
  }, []);

  /** 预览文件 */
  const handlePreviewFile = useCallback(
    async (item: AttachmentItem) => {
      const mimeType = item.file.mimeType;

      if (!mimeType) {
        // 无 MIME 类型，直接下载
        await downloadFile(item);
        return;
      }

      if (mimeType.startsWith('image/')) {
        // 图片：fetch blob → object URL → ImagePreview
        try {
          const blob = await fetchProtectedFile(item.file.url);
          const objectUrl = globalThis.URL.createObjectURL(blob);
          setImagePreviewUrl(objectUrl);
        } catch {
          Toast.error('加载图片失败');
        }
        return;
      }

      if (canPreviewFile(mimeType)) {
        // PDF/音频/视频：用 FilePreviewModal
        setPreviewFile({
          url: item.file.url,
          name: item.file.originalName,
          mimeType,
        });
        setPreviewVisible(true);
        return;
      }

      // 不支持预览，直接下载
      await downloadFile(item);
    },
    [downloadFile],
  );

  /** renderFileItem：自定义整行渲染（包含缩略图、文件名、大小、操作区） */
  const renderFileItem = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const item = toAttachmentItem(props);
      const fileSize = item.file.size ? formatFileSize(item.file.size) : '';
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderBottom: '1px solid var(--semi-color-border-light)',
            width: '100%',
          }}
        >
          {/* 文件图标 */}
          {getFileTypeIcon(item.file.mimeType, 18)}
          {/* 文件名 + 大小 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text
              size="small"
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.file.originalName}
            </Text>
            <Text type="tertiary" size="small">
              {fileSize}
            </Text>
          </div>
          {/* 操作区 */}
          <Space>
            <Button
              theme="borderless"
              type="primary"
              icon={<Eye size={12} />}
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handlePreviewFile(item);
              }}
            />
            <Button
              theme="borderless"
              type="primary"
              icon={<Download size={12} />}
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(item);
              }}
            />
            {isEditMode && (
              <Button
                theme="borderless"
                type="danger"
                icon={<X size={12} />}
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove();
                }}
              />
            )}
          </Space>
        </div>
      );
    },
    [toAttachmentItem, handlePreviewFile, downloadFile, isEditMode],
  );

  /** 上传成功 */
  const handleSuccess = useCallback(
    (res: unknown) => {
      const r = res as {
        code?: number;
        data?: {
          id: number;
          url: string;
          originalName?: string;
          size?: number;
          mimeType?: string;
          extension?: string;
        };
      };
      if (r?.code === 0 && r.data) {
        const d = r.data;
        const newItem: AttachmentItem = {
          id: Date.now(),
          fileId: d.id,
          file: {
            id: d.id,
            originalName: d.originalName ?? '未命名文件',
            size: d.size ?? 0,
            mimeType: d.mimeType ?? null,
            extension: d.extension ?? null,
            url: d.url,
          },
          sortOrder: value.length,
          createdAt: new Date().toISOString(),
        };
        onChange?.([...value, newItem]);
        Toast.success('上传成功');
      }
    },
    [value, onChange],
  );

  /** 上传前校验 */
  const handleBeforeUpload = useCallback(
    ({ file }: { file: { name: string; size?: string | number } }) => {
      const fileSize = typeof file.size === 'number' ? file.size : Number(file.size);
      if (fileSize > maxSizeMB * 1024 * 1024) {
        Toast.warning(`${file.name} 超过 ${maxSizeMB}MB，已跳过`);
        return false;
      }
      if (limit > 0 && value.length >= limit) {
        Toast.warning(`最多上传 ${limit} 个文件`);
        return false;
      }
      return true;
    },
    [maxSizeMB, limit, value.length],
  );

  /** 移除文件（通过 onChange 受控） */
  const handleRemove = useCallback(
    (fileItem: FileItem) => {
      const item = toAttachmentItem(fileItem);
      const next = value.filter((a) => a.id !== item.id);
      onChange?.(next);
    },
    [value, onChange, toAttachmentItem],
  );

  /** onChange（受控 fileList） */
  const handleFileListChange = useCallback(
    ({ fileList: newFileList }: { fileList: FileItem[] }) => {
      // 将 FileItem 转回 AttachmentItem
      const newItems = newFileList.map(toAttachmentItem);
      onChange?.(newItems);
    },
    [onChange, toAttachmentItem],
  );

  return (
    <div style={style}>
      {/* 标题 */}
      {showTitle && (
        <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>
          {title}
          {value.length > 0 && (
            <Text type="tertiary" size="small" style={{ marginLeft: 4 }}>
              （{value.length}）
            </Text>
          )}
        </div>
      )}

      {/* 使用 Semi Upload 组件，listType="list" */}
      <Upload
        action={uploadAction}
        headers={uploadHeaders}
        name="file"
        fileList={uploadFileList}
        listType="list"
        accept={accept}
        limit={limit > 0 ? limit : undefined}
        beforeUpload={isEditMode ? handleBeforeUpload : undefined}
        onSuccess={isEditMode ? handleSuccess : undefined}
        onError={() => {
          Toast.error('上传失败，请重试');
        }}
        onRemove={isEditMode ? (fileItem) => handleRemove(fileItem as unknown as FileItem) : undefined}
        onChange={isEditMode ? handleFileListChange : undefined}
        renderFileItem={renderFileItem}
        disabled={!isEditMode}
        showClear={false}
      >
        {isEditMode && (limit === 0 || value.length < limit) && (
          <Button theme="light" icon={<Plus size={14} />}>
            {uploadTip || '上传文件'}
          </Button>
        )}
      </Upload>

      {/* 文件预览弹窗（PDF/音频/视频） */}
      {previewFile && (
        <FilePreviewModal
          visible={previewVisible}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          onClose={() => {
            setPreviewVisible(false);
            setPreviewFile(null);
          }}
          onFallback={() => {
            setPreviewVisible(false);
            setPreviewFile(null);
          }}
        />
      )}

      {/* 图片预览 */}
      {imagePreviewUrl && (
        <ImagePreview
          src={imagePreviewUrl}
          visible={!!imagePreviewUrl}
          onVisibleChange={(v) => {
            if (!v) setImagePreviewUrl(null);
          }}
        />
      )}
    </div>
  );
}
