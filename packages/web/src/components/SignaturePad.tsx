import { Button } from '@douyinfe/semi-ui';
import { Eraser } from 'lucide-react';
import { useSignaturePad } from '@/hooks/useSignaturePad';

interface Props {
  value?: string;
  onChange?: (dataUrl: string) => void;
  width?: number;
  height?: number;
  disabled?: boolean;
}

/** 轻量手写签名板：基于 canvas，输出 PNG data URL */
export default function SignaturePad({ value, onChange, width = 360, height = 140, disabled }: Readonly<Props>) {
  const { canvasRef, handlePointerDown, handlePointerMove, handlePointerUp, clear } = useSignaturePad({
    value,
    onChange,
    disabled,
  });

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          border: '1px dashed var(--semi-color-border)',
          borderRadius: 6,
          background: '#fff',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'crosshair',
        }}
      />
      <div>
        <Button theme="borderless" size="small" icon={<Eraser size={14} />} onClick={clear} disabled={disabled}>
          清除{value ? '（已签名）' : ''}
        </Button>
      </div>
    </div>
  );
}
