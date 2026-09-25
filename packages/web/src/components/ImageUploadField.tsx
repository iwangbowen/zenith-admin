/** 单图上传字段（受控）：已上传时展示预览缩略图 + 悬浮删除按钮，未上传时展示上传按钮。 */
import { Button, Space, Toast, Upload } from '@douyinfe/semi-ui';
import { ImagePlus, Trash2 } from 'lucide-react';
import { fileContract } from '@zenith/shared/platform';
import { config } from '@/config';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';

const UPLOAD_ACTION = `${config.apiBaseUrl}${urlOf(fileContract.uploadOne)}`;

/** 从统一响应包络中取出上传后的文件 URL；失败返回 null */
function extractUploadUrl(res: unknown): string | null {
  const r = res as { code?: number; data?: { url?: string } };
  return r?.code === 0 && r.data?.url ? r.data.url : null;
}

interface ImageUploadFieldProps {
  /** 当前图片 URL，空串表示未上传 */
  readonly value: string;
  readonly onChange: (url: string) => void;
  /** 上传按钮文案，同时用于成功/失败提示（如「图片」「封面」） */
  readonly label?: string;
  /** 预览图尺寸；默认按内容自适应且限制最大边长 */
  readonly previewStyle?: React.CSSProperties;
  readonly accept?: string;
  /** 领域上传或本地待提交文件：返回值原样交给 onChange，预览 URL 由调用方解析。 */
  readonly customUpload?: (file: File) => Promise<string>;
  readonly disabled?: boolean;
  /** 上传按钮尺寸；紧凑表单字段传 'small' 与相邻操作按钮对齐，默认随 Semi 默认尺寸 */
  readonly buttonSize?: 'small' | 'default' | 'large';
  /** 本地预备文件可关闭“已上传”提示，避免尚未持久化时误导用户。 */
  readonly uploadSuccessMessage?: string | false;
}

const DEFAULT_PREVIEW_STYLE: React.CSSProperties = { maxWidth: 240, maxHeight: 180 };

export function ImageUploadField({
  value,
  onChange,
  label = '图片',
  previewStyle = DEFAULT_PREVIEW_STYLE,
  accept = 'image/*',
  customUpload,
  disabled = false,
  buttonSize,
  uploadSuccessMessage,
}: ImageUploadFieldProps) {
  const uploaded = (url: string) => {
    onChange(url);
    if (uploadSuccessMessage !== false) Toast.success(uploadSuccessMessage ?? `${label}已上传`);
  };
  return (
    <Space align="start">
      {value
        ? (
          <div style={{ position: 'relative' }}>
            <img
              src={value}
              alt={label}
              style={{
                ...previewStyle,
                objectFit: 'cover',
                borderRadius: 'var(--semi-border-radius-medium)',
                border: '1px solid var(--semi-color-border)',
              }}
            />
            <Button
              theme="borderless"
              type="danger"
              size="small"
              icon={<Trash2 size={14} />}
              aria-label={`删除${label}`}
              disabled={disabled}
              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.8)' }}
              onClick={() => onChange('')}
            />
          </div>
        )
        : (
          <Upload
            action={UPLOAD_ACTION}
            headers={() => request.authHeaders()}
            name="file"
            accept={accept}
            limit={1}
            showUploadList={false}
            disabled={disabled}
            customRequest={customUpload ? async ({ fileInstance, onSuccess, onError }) => {
              try {
                const url = await customUpload(fileInstance);
                uploaded(url);
                onSuccess?.({ code: 0, data: { url } });
              } catch (error) {
                Toast.error(error instanceof Error ? error.message : `${label}上传失败`);
                onError?.({ status: 0 });
              }
            } : undefined}
            onSuccess={(res) => {
              if (customUpload) return;
              const url = extractUploadUrl(res);
              if (url) {
                uploaded(url);
              } else {
                Toast.error(`${label}上传失败`);
              }
            }}
          >
            <Button size={buttonSize} disabled={disabled} icon={<ImagePlus size={14} />}>上传{label}</Button>
          </Upload>
        )}
    </Space>
  );
}
