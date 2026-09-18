import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { fileContract } from '@zenith/shared/platform';
import { useApiMutation } from '@/lib/contract-query';

export interface UseAvatarCropUploadOptions {
  /**
   * 裁剪结果上传成功后的落库动作（改本人资料 / 管理员改他人）。
   * 返回 `false` 表示落库失败且已自行提示，裁剪弹窗保持打开供重试；其余返回值视为成功并关闭裁剪弹窗。
   */
  readonly onUploaded: (url: string) => Promise<boolean | void> | boolean | void;
  /**
   * 裁剪 Blob 的上传实现；缺省走管理后台文件中心（`fileContract.uploadOne`）。
   * 会员前台等走独立上传通道的调用方传入自己的实现（如会员头像上传接口）。
   */
  readonly uploadBlob?: (blob: Blob) => Promise<string>;
  /** 本地图片大小上限（MB），默认 2；与会员端编辑资料页保持一致 */
  readonly maxSizeMB?: number;
}

/**
 * 头像「选文件 → 裁剪 → 上传文件中心 → 落库」的公共流程。
 *
 * 页面只需：把 `fileInputProps` 展开到隐藏的 `<input>`、用 `openFilePicker` 触发选择、
 * 把 `cropperProps` 展开到 `<AvatarCropperModal>`，并在 `onUploaded` 里完成各自的落库动作。
 * 上传失败的提示由本 hook 统一给出（请求层静默），落库失败的提示由调用方按场景给出。
 */
export function useAvatarCropUpload({ onUploaded, uploadBlob, maxSizeMB = 2 }: UseAvatarCropUploadOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [customUploading, setCustomUploading] = useState(false);
  // 失败提示由调用处按场景给出，请求层静默；code !== 0 由 api() 抛 ApiError
  const uploadMutation = useApiMutation(fileContract.uploadOne, { requestOptions: { silent: true } });

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/')) {
      Toast.warning('请选择图片文件');
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      Toast.warning(`图片不能超过 ${maxSizeMB}MB`);
      return;
    }
    setCropFile(file);
  }

  async function defaultUploadBlob(blob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('file', blob, 'avatar.jpg');
    return (await uploadMutation.mutateAsync({ body: formData })).url;
  }

  async function handleCropConfirm(blob: Blob) {
    let uploadedUrl: string;
    if (uploadBlob) {
      setCustomUploading(true);
      try {
        uploadedUrl = await uploadBlob(blob);
      } catch (err) {
        Toast.error(err instanceof Error && err.message ? err.message : '上传失败');
        return;
      } finally {
        setCustomUploading(false);
      }
    } else {
      try {
        uploadedUrl = await defaultUploadBlob(blob);
      } catch (err) {
        Toast.error(err instanceof Error && err.message ? err.message : '上传失败');
        return;
      }
    }
    if ((await onUploaded(uploadedUrl)) === false) return;
    setCropFile(null);
  }

  return {
    /** 当前待裁剪的文件；为 null 时裁剪弹窗关闭 */
    cropFile,
    uploading: uploadMutation.isPending || customUploading,
    openFilePicker: () => inputRef.current?.click(),
    /** 展开到隐藏的 `<input>`；需要额外属性（如 `id`）时在展开后补充 */
    fileInputProps: {
      ref: inputRef as RefObject<HTMLInputElement>,
      type: 'file' as const,
      accept: 'image/*',
      style: { display: 'none' } as const,
      onChange: handleFileSelect,
    },
    /** 展开到 `<AvatarCropperModal>`；`confirmLoading` 由调用方按自身落库状态合并后传入 */
    cropperProps: {
      file: cropFile,
      onCancel: () => setCropFile(null),
      onConfirm: (blob: Blob) => { void handleCropConfirm(blob); },
    },
  };
}
