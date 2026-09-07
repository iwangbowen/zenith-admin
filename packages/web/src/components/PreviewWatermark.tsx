import { useEffect, useState } from 'react';
import { generateWatermarkTile } from './watermark-tile';

interface PreviewWatermarkProps {
  readonly content: string | string[] | null | undefined;
  readonly visible: boolean;
}

/**
 * 预览水印：覆盖整个视口且位于预览弹层之上（Semi Modal / ImagePreview 通过 portal 挂到 body，
 * 页面内的 Watermark 覆盖不到），只在预览打开时渲染，不拦截任何交互。
 */
export function PreviewWatermark({ content, visible }: PreviewWatermarkProps) {
  const lines = (Array.isArray(content) ? content : content ? [content] : []).filter(Boolean);
  const key = lines.join('\n');
  const [style, setStyle] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    if (!visible || lines.length === 0) { setStyle(null); return; }
    const isDark = document.body.getAttribute('theme-mode') === 'dark';
    const tile = generateWatermarkTile(lines, 13, 0.22, -22, 180, 110, isDark);
    if (!tile) return;
    setStyle({
      position: 'fixed', inset: 0, pointerEvents: 'none', userSelect: 'none', zIndex: 2100,
      backgroundImage: `url(${tile.dataUrl})`, backgroundRepeat: 'repeat', backgroundSize: `${tile.cssWidth}px ${tile.cssHeight}px`,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);

  if (!style) return null;
  return <div aria-hidden style={style} data-testid="preview-watermark" />;
}
