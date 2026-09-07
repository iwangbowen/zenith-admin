import { useEffect, useRef } from 'react';
import { generateWatermarkTile } from './watermark-tile';

interface WatermarkProps {
  content: string | string[];
  fontSize?: number;
  opacity?: number;
  rotate?: number;
  gapX?: number;
  gapY?: number;
  zIndex?: number;
  /** 深色模式下用浅色文字，保证水印可见 */
  isDark?: boolean;
  children: React.ReactNode;
}

export default function Watermark({
  content,
  fontSize = 14,
  opacity = 0.15,
  rotate = -22,
  gapX = 212,
  gapY = 120,
  zIndex = 9,
  isDark = false,
  children,
}: Readonly<WatermarkProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const lines = Array.isArray(content) ? content : [content];

  useEffect(() => {
    const tile = generateWatermarkTile(lines, fontSize, opacity, rotate, gapX, gapY, isDark);
    if (!tile) return;

    if (!overlayRef.current) {
      const div = document.createElement('div');
      div.style.cssText = [
        'position:absolute',
        'inset:0',
        'pointer-events:none',
        'user-select:none',
        `z-index:${zIndex}`,
      ].join(';');
      overlayRef.current = div;
    }
    overlayRef.current.style.backgroundImage = `url(${tile.dataUrl})`;
    overlayRef.current.style.backgroundRepeat = 'repeat';
    // 画布按 DPR 放大绘制，这里缩回 CSS 尺寸，避免高分屏水印被放大且模糊
    overlayRef.current.style.backgroundSize = `${tile.cssWidth}px ${tile.cssHeight}px`;

    const container = containerRef.current;
    if (container) {
      container.style.position = 'relative';
      container.appendChild(overlayRef.current);
    }

    return () => {
      overlayRef.current?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lines), fontSize, opacity, rotate, gapX, gapY, zIndex, isDark]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {children}
    </div>
  );
}
