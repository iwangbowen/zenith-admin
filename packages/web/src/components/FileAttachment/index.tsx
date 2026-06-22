import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Upload,
  Button,
  Space,
  Typography,
  ImagePreview,
  Toast,
  Progress,
} from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import type { FileItem, RenderFileItemProps } from '@douyinfe/semi-ui/lib/es/upload';
import { Plus, Download, X, Eye, RotateCcw } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { formatDateTime } from '@/utils/date';
import {
  getFileTypeIcon,
  canPreviewFile,
  fetchProtectedFile,
  formatFileSize,
} from '@/utils/file-utils';
import FilePreviewModal from '@/components/FilePreviewModal';

const { Text } = Typography;
const UPLOAD_PENDING_STATUSES = new Set(['wait', 'validating', 'uploading']);

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 附件项（与后端 AnnouncementAttachment 兼容） */
export interface AttachmentItem {
  id: number;
  fileId: string;
  file: {
    id: string;
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
  /** 是否允许一次选择多个文件，默认允许 */
  multiple?: boolean;
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

type ManagedFileResponse = {
  id: string;
  url: string;
  originalName: string;
  size: number;
  mimeType?: string | null;
  extension?: string | null;
  createdAt?: string;
};

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

function isAttachmentFileItem(item: FileItem | RenderFileItemProps | null | undefined): item is FileItem & AttachmentItem {
  if (!item) return false;
  const maybeAttachment = item as Partial<AttachmentItem>;
  return typeof maybeAttachment.fileId === 'string' && maybeAttachment.file?.originalName != null;
}

function toAttachmentFromManagedFile(file: ManagedFileResponse, sortOrder: number): AttachmentItem {
  return {
    id: -Date.now(),
    fileId: file.id,
    file: {
      id: file.id,
      originalName: file.originalName,
      size: file.size,
      mimeType: file.mimeType ?? null,
      extension: file.extension ?? null,
      url: file.url,
    },
    sortOrder,
    createdAt: file.createdAt ?? formatDateTime(new Date()),
  };
}

function toManagedFileResponse(res: unknown): ManagedFileResponse | null {
  const r = res as { code?: number; data?: ManagedFileResponse } | undefined;
  return r?.code === 0 && r.data ? r.data : null;
}

function isFailedApiResponse(res: unknown): boolean {
  const r = res as { code?: number } | undefined;
  return typeof r?.code === 'number' && r.code !== 0;
}

function isUploadPending(item: FileItem): boolean {
  return UPLOAD_PENDING_STATUSES.has(item.status);
}

// ─── 组件实现 ────────────────────────────────────────────────────────────────

export default function FileAttachment({
  value = [],
  onChange,
  mode = 'view',
  limit = 0,
  multiple = true,
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
    id: string;
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

  /** Semi Upload fileList (view 模式使用 defaultFileList，edit 模式使用受控 fileList) */
  const uploadFileList = useMemo(
    () => value.filter((item) => item?.file != null).map(toUploadFileItem),
    [value],
  );
  const [fileList, setFileList] = useState<FileItem[]>(uploadFileList);
  const attachmentsRef = useRef<AttachmentItem[]>(value);
  const pendingUploadUidsRef = useRef<Set<string>>(new Set());
  const failedUploadCountRef = useRef(0);

  useEffect(() => {
    attachmentsRef.current = value;
    setFileList((prev) => {
      const activeUploadingFiles = isEditMode
        ? prev.filter((item) => !isAttachmentFileItem(item) && ['wait', 'validating', 'uploading'].includes(item.status))
        : [];
      return [...uploadFileList, ...activeUploadingFiles];
    });
  }, [value, uploadFileList, isEditMode]);

  /** 本轮上传全部结束后统一提示一次，避免多选时连续弹 Toast */
  const finishUpload = useCallback((file: File, failed: boolean, nextFileList: FileItem[]) => {
    const uid = (file as File & { uid?: string }).uid;
    if (failed) failedUploadCountRef.current += 1;
    if (uid) pendingUploadUidsRef.current.delete(uid);

    if (pendingUploadUidsRef.current.size > 0 || nextFileList.some(isUploadPending)) return;

    const failedCount = failedUploadCountRef.current;
    failedUploadCountRef.current = 0;
    pendingUploadUidsRef.current.clear();
    if (failedCount > 0) {
      Toast.error(failedCount === 1 ? '1 个文件上传失败' : `${failedCount} 个文件上传失败`);
    } else {
      Toast.success('上传成功');
    }
  }, []);

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
          id: item.file.id,
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
    (props: RenderFileItemProps) => {
      // 检查是否是完整的 AttachmentItem（有 file 属性）
      if (!isAttachmentFileItem(props)) {
        // 上传中的临时文件，只显示基本信息
        const percent = Math.max(0, Math.min(100, Math.round(props.percent ?? 0)));
        const isUploading = props.status === 'uploading' || props.status === 'wait' || props.status === 'validating';
        const isFailed = props.status === 'uploadFail';
        const rawSize = props.fileInstance?.size ?? Number(props.size);
        const fileSize = Number.isFinite(rawSize) && rawSize > 0 ? formatFileSize(rawSize) : '';
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
            {getFileTypeIcon(props.fileInstance?.type || null, 18)}
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
                {props.name || '上传中...'}
              </Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                {fileSize && (
                  <Text type="tertiary" size="small">
                    {fileSize}
                  </Text>
                )}
                {isUploading && (
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <Progress percent={percent} size="small" showInfo={false} />
                  </div>
                )}
                <Text type={isFailed ? 'danger' : 'tertiary'} size="small">
                  {isFailed ? '上传失败' : isUploading ? `${percent}%` : ''}
                </Text>
              </div>
            </div>
            <Space>
              {isEditMode && isFailed && (
                <Button
                  theme="borderless"
                  type="primary"
                  icon={<RotateCcw size={12} />}
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    pendingUploadUidsRef.current.add(props.uid);
                    props.onRetry();
                  }}
                />
              )}
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
      }

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
    (res: unknown, _file: File, nextFileList: FileItem[]) => {
      const r = res as {
        code?: number;
        message?: string;
        data?: ManagedFileResponse;
      };
      if (r?.code !== 0 || !r.data) {
        const uid = (_file as File & { uid?: string }).uid;
        const failedFileList = nextFileList.map((item) =>
          item.uid === uid ? { ...item, status: 'uploadFail' as const, response: res } : item,
        );
        setFileList(failedFileList);
        finishUpload(_file, true, failedFileList);
        return;
      }

      const attachment = toAttachmentFromManagedFile(r.data, attachmentsRef.current.length);
      const uploadedFileItem = toUploadFileItem(attachment);
      const nextAttachments = [
        ...attachmentsRef.current.filter((item) => item.fileId !== attachment.fileId),
        attachment,
      ];

      attachmentsRef.current = nextAttachments;
      const updatedFileList = nextFileList.map((item) =>
        item.response === res || item.uid === (_file as File & { uid?: string }).uid ? uploadedFileItem : item,
      );
      setFileList(updatedFileList);
      onChange?.(nextAttachments);
      finishUpload(_file, false, updatedFileList);
    },
    [finishUpload, onChange],
  );

  /** onChange（文件列表变化时同步到父组件） */
  const handleFileListChange = useCallback(
    ({ fileList: newFileList }: { fileList: FileItem[] }) => {
      let nextSortOrder = attachmentsRef.current.length;
      setFileList(
        newFileList.map((item) => {
          if (isAttachmentFileItem(item)) return item;
          const uploadedFile = toManagedFileResponse(item.response);
          if (!uploadedFile && isFailedApiResponse(item.response)) {
            return { ...item, status: 'uploadFail' as const };
          }
          if (!uploadedFile) return item;
          const existingAttachment = attachmentsRef.current.find((attachment) => attachment.fileId === uploadedFile.id);
          const attachment = existingAttachment ?? toAttachmentFromManagedFile(uploadedFile, nextSortOrder++);
          return toUploadFileItem(attachment);
        }),
      );
    },
    [],
  );

  /** 上传前校验 */
  const handleBeforeUpload = useCallback(
    ({ file }: { file: FileItem }) => {
      const fileSize = file.fileInstance?.size ?? Number(file.size);
      if (fileSize > maxSizeMB * 1024 * 1024) {
        Toast.warning(`${file.name} 超过 ${maxSizeMB}MB，已跳过`);
        return false;
      }
      if (limit > 0 && fileList.length >= limit) {
        Toast.warning(`最多上传 ${limit} 个文件`);
        return false;
      }
      pendingUploadUidsRef.current.add(file.uid);
      return true;
    },
    [maxSizeMB, limit, fileList.length],
  );

  /** 上传进度 */
  const handleProgress = useCallback(
    (_percent: number, _file: File, nextFileList: FileItem[]) => {
      setFileList(nextFileList);
    },
    [],
  );

  /** 上传失败 */
  const handleError = useCallback(
    (_error: unknown, _file: File, nextFileList: FileItem[]) => {
      setFileList(nextFileList);
      finishUpload(_file, true, nextFileList);
    },
    [finishUpload],
  );

  /** 超出上传数量限制 */
  const handleExceed = useCallback(() => {
    if (limit > 0) {
      Toast.warning(`最多上传 ${limit} 个文件`);
    }
  }, [limit]);

  /** 移除文件（通过 onChange 受控） */
  const handleRemove = useCallback(
    (fileItem: FileItem | undefined) => {
      if (!fileItem) return;
      if (!isAttachmentFileItem(fileItem)) {
        setFileList((prev) => prev.filter((file) => file.uid !== fileItem.uid));
        return;
      }
      const item = toAttachmentItem(fileItem);
      const next = attachmentsRef.current.filter((a) => a.id !== item.id);
      attachmentsRef.current = next;
      setFileList((prev) => prev.filter((file) => file.uid !== fileItem.uid));
      onChange?.(next);
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
        fileList={fileList}
        listType="list"
        accept={accept}
        limit={limit > 0 ? limit : undefined}
        multiple={multiple}
        beforeUpload={isEditMode ? handleBeforeUpload : undefined}
        onProgress={isEditMode ? handleProgress : undefined}
        onSuccess={isEditMode ? handleSuccess : undefined}
        onChange={isEditMode ? handleFileListChange : undefined}
        onError={isEditMode ? handleError : undefined}
        onExceed={isEditMode ? handleExceed : undefined}
        onRemove={isEditMode ? (_file, _fileList, currentFileItem) => handleRemove(currentFileItem) : undefined}
        renderFileItem={renderFileItem}
        disabled={!isEditMode}
        showClear={false}
      >
        {isEditMode && (limit === 0 || fileList.length < limit) && (
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
          fileId={previewFile.id}
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
