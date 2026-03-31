import { useEffect, useRef } from 'react';

interface WatermarkProps {
  content: string | string[];
  fontSize?: number;
  opacity?: number;
  rotate?: number;
  gapX?: number;
  gapY?: number;
  zIndex?: number;
  children: React.ReactNode;
}

function generateDataUrl(
  content: string[],
  fontSize: number,
  opacity: number,
  rotate: number,
  gapX: number,
  gapY: number,
): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const dpr = window.devicePixelRatio || 1;
  const fontFamily = 'sans-serif';
  const scaledFontSize = fontSize * dpr;

  ctx.font = `${scaledFontSize}px ${fontFamily}`;
  const maxWidth = Math.max(...content.map((t) => ctx.measureText(t).width));
  const lineHeight = scaledFontSize * 1.5;
  const textHeight = lineHeight * content.length;

  const tileW = maxWidth + gapX * dpr;
  const tileH = textHeight + gapY * dpr;

  canvas.width = tileW;
  canvas.height = tileH;

  ctx.translate(tileW / 2, tileH / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.translate(-tileW / 2, -tileH / 2);

  ctx.globalAlpha = opacity;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.font = `${scaledFontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  content.forEach((line, i) => {
    const y = tileH / 2 - textHeight / 2 + lineHeight * i + lineHeight / 2;
    ctx.fillText(line, tileW / 2, y);
  });

  return canvas.toDataURL();
}

export default function Watermark({
  content,
  fontSize = 14,
  opacity = 0.15,
  rotate = -22,
  gapX = 212,
  gapY = 120,
  zIndex = 9,
  children,
}: Readonly<WatermarkProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const lines = Array.isArray(content) ? content : [content];

  useEffect(() => {
    const dataUrl = generateDataUrl(lines, fontSize, opacity, rotate, gapX, gapY);

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
    overlayRef.current.style.backgroundImage = `url(${dataUrl})`;
    overlayRef.current.style.backgroundRepeat = 'repeat';

    const container = containerRef.current;
    if (container) {
      container.style.position = 'relative';
      container.appendChild(overlayRef.current);
    }

    return () => {
      overlayRef.current?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lines), fontSize, opacity, rotate, gapX, gapY, zIndex]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {children}
    </div>
  );
}
