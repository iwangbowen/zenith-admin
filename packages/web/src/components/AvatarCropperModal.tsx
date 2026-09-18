import { useEffect, useRef, useState } from 'react';
import { Button, Cropper, Space } from '@douyinfe/semi-ui';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { AppModal } from './AppModal';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

/**
 * 将缩放值收敛到步长精度并夹紧到允许区间；非有限值返回 null。
 * Semi Slider 在轨道尚无布局宽度时可能算出 NaN，一律在此挡掉，避免污染受控的 zoom 状态。
 */
function normalizeZoom(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Number((Math.round(value / ZOOM_STEP) * ZOOM_STEP).toFixed(2));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rounded));
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
 * 头像裁剪弹窗：圆形裁剪框 + 受控旋转 / 缩放（Semi Cropper `rotate` / `zoom`）。
 * 内部管理旋转角度、缩放倍数与图片预览地址（blob URL）的创建与释放。
 */
export function AvatarCropperModal({ file, confirmLoading, onCancel, onConfirm }: AvatarCropperModalProps) {
  const cropperRef = useRef<Cropper>(null);
  const srcRef = useRef('');
  const [src, setSrc] = useState('');
  const [rotate, setRotate] = useState(0);
  const [zoom, setZoom] = useState(1);

  // 更新预览地址并释放上一个 blob URL
  const updateSrc = (next: string) => {
    if (srcRef.current.startsWith('blob:')) URL.revokeObjectURL(srcRef.current);
    srcRef.current = next;
    setSrc(next);
  };

  useEffect(() => {
    setRotate(0);
    setZoom(1);
    if (!file) {
      updateSrc('');
      return;
    }
    updateSrc(URL.createObjectURL(file));
    return () => {
      updateSrc('');
    };
  }, [file]);

  function handleRotate(delta: number) {
    setRotate((prev) => (((prev + delta) % 360) + 360) % 360);
  }

  function handleZoomChange(value: number | number[] | undefined) {
    if (value === undefined) return;
    const next = normalizeZoom(typeof value === 'number' ? value : value[0]);
    if (next !== null) setZoom(next);
  }

  function handleZoomStep(delta: number) {
    setZoom((prev) => normalizeZoom(Number((prev + delta).toFixed(2))) ?? prev);
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
            rotate={rotate}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            zoomStep={ZOOM_STEP}
            onZoomChange={handleZoomChange}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12 }}>
        <Button icon={<RotateCcw size={14} />} size="small" theme="borderless" onClick={() => handleRotate(-90)}>向左旋转</Button>
        <Button icon={<RotateCw size={14} />} size="small" theme="borderless" onClick={() => handleRotate(90)}>向右旋转</Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8 }}>
        <Button icon={<ZoomOut size={14} />} size="small" theme="borderless" aria-label="缩小" disabled={zoom <= MIN_ZOOM} onClick={() => handleZoomStep(-ZOOM_STEP)}>缩小</Button>
        <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', minWidth: 44, textAlign: 'center' }}>{zoom.toFixed(1)}x</span>
        <Button icon={<ZoomIn size={14} />} size="small" theme="borderless" aria-label="放大" disabled={zoom >= MAX_ZOOM} onClick={() => handleZoomStep(ZOOM_STEP)}>放大</Button>
      </div>
    </AppModal>
  );
}
