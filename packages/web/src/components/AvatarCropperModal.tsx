import { useEffect, useRef, useState } from 'react';
import { Button, Cropper, Space } from '@douyinfe/semi-ui';
import { RotateCcw, RotateCw } from 'lucide-react';
import { AppModal } from './AppModal';

/** 将图片文件旋转指定角度后返回 data URL（用于规避 Semi Cropper rotate prop 的 bug） */
function createRotatedImage(file: File, angleDeg: number): Promise<string> {
  return new Promise((resolve) => {
    if (angleDeg % 360 === 0) {
      resolve(URL.createObjectURL(file));
      return;
    }
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const rad = (angleDeg * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const w = img.naturalWidth * cos + img.naturalHeight * sin;
      const h = img.naturalWidth * sin + img.naturalHeight * cos;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = objUrl;
  });
}

export interface AvatarCropperModalProps {
  /** 待裁剪的原始图片文件；为 null 时关闭弹窗 */
  readonly file: File | null;
  /** 确认按钮 loading（上传/保存中） */
  readonly confirmLoading?: boolean;
  readonly onCancel: () => void;
  /** 用户确认裁剪后回调裁剪结果（JPEG Blob，质量 0.85） */
  readonly onConfirm: (blob: Blob) => void;
}

/**
 * 头像裁剪弹窗：圆形裁剪框 + 左右旋转。
 * 内部管理旋转角度与图片预览地址（blob/data URL）的创建与释放。
 */
export function AvatarCropperModal({ file, confirmLoading, onCancel, onConfirm }: AvatarCropperModalProps) {
  const cropperRef = useRef<Cropper>(null);
  const srcRef = useRef('');
  const [src, setSrc] = useState('');
  const [rotate, setRotate] = useState(0);

  // 更新预览地址并释放上一个 blob URL
  const updateSrc = (next: string) => {
    if (srcRef.current.startsWith('blob:')) URL.revokeObjectURL(srcRef.current);
    srcRef.current = next;
    setSrc(next);
  };

  useEffect(() => {
    setRotate(0);
    if (!file) {
      updateSrc('');
      return;
    }
    updateSrc(URL.createObjectURL(file));
    return () => {
      updateSrc('');
    };
  }, [file]);

  async function handleRotate(delta: number) {
    if (!file) return;
    const newAngle = ((rotate + delta) % 360 + 360) % 360;
    setRotate(newAngle);
    updateSrc(await createRotatedImage(file, newAngle));
  }

  function handleConfirm() {
    const canvas = cropperRef.current?.getCropperCanvas();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      onConfirm(blob);
    }, 'image/jpeg', 0.85);
  }

  return (
    <AppModal
      title="裁剪头像"
      visible={file !== null}
      onCancel={onCancel}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={confirmLoading} onClick={handleConfirm}>确认并上传</Button>
        </Space>
      }
      width={520}
      centered
    >
      <div style={{ width: '100%', height: 380 }}>
        {src && (
          <Cropper
            ref={cropperRef}
            src={src}
            shape="round"
            aspectRatio={1}
            showResizeBox
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12 }}>
        <Button icon={<RotateCcw size={14} />} size="small" theme="borderless" onClick={() => void handleRotate(-90)}>向左旋转</Button>
        <Button icon={<RotateCw size={14} />} size="small" theme="borderless" onClick={() => void handleRotate(90)}>向右旋转</Button>
      </div>
    </AppModal>
  );
}
