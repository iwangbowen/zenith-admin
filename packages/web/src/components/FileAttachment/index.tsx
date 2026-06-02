import { useState, useCallback, useMemo } from 'react';
import { Upload, Button, Space, Typography, ImagePreview, Toast } from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import { Plus, Download, X } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import {
  formatFileSize,
  getFileTypeIcon,
  canPreviewFile,
  fetchProtectedFile,
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

  /** 移除附件 */
  const handleRemove = useCallback(
    (item: AttachmentItem) => {
      if (!isEditMode) return;
      const next = value.filter((a) => a.id !== item.id);
      onChange?.(next);
    },
    [isEditMode, value, onChange],
  );

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

  /** 预览或下载 */
  const handlePreview = useCallback(
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
        // PDF/音频/视频：用 FilePreviewModal（内部已处理 fetchProtectedFile）
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
      // 数量限制
      if (limit > 0 && value.length >= limit) {
        Toast.warning(`最多上传 ${limit} 个文件`);
        return false;
      }
      return true;
    },
    [maxSizeMB, limit, value.length],
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

      {/* 附件列表 */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {value.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                handlePreview(item);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handlePreview(item);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                border: '1px solid var(--semi-color-border)',
                borderRadius: 6,
                gap: 10,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
                background: 'transparent',
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--semi-color-bg-2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '';
              }}
            >
              {getFileTypeIcon(item.file.mimeType, 18)}
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
                  {formatFileSize(item.file.size)}
                </Text>
              </div>
              <Space>
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
                      handleRemove(item);
                    }}
                  />
                )}
              </Space>
            </button>
          ))}
        </div>
      )}

      {/* 上传区域 */}
      {isEditMode && (limit === 0 || value.length < limit) && (
        <Upload
          action={uploadAction}
          headers={uploadHeaders}
          name="file"
          draggable
          accept={accept}
          beforeUpload={handleBeforeUpload}
          onSuccess={handleSuccess}
          onError={() => {
            Toast.error('上传失败，请重试');
          }}
          showUploadList={false}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 16px',
              border: '1px dashed var(--semi-color-border)',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.2s',
              color: 'var(--semi-color-text-1)',
            }}
          >
            <Plus size={16} />
            <Text size="small">
              {uploadTip || '点击或拖拽上传文件'}
            </Text>
          </div>
        </Upload>
      )}

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
