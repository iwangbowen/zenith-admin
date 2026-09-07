export interface WatermarkTile {
  dataUrl: string;
  /** 平铺尺寸（CSS 像素），供 background-size 抵消 DPR 放大 */
  cssWidth: number;
  cssHeight: number;
}

/** 生成一块可平铺的水印画布（按 DPR 放大绘制，返回 CSS 尺寸供缩回） */
export function generateWatermarkTile(
  content: string[],
  fontSize: number,
  opacity: number,
  rotate: number,
  gapX: number,
  gapY: number,
  isDark: boolean,
): WatermarkTile | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

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

  // 暗色表面上低亮度差的感知对比更弱：深色模式用纯白并上调等效不透明度，浅色保持原样
  ctx.globalAlpha = Math.min(1, isDark ? opacity * 1.6 : opacity);
  ctx.fillStyle = isDark ? '#fff' : 'rgba(0,0,0,0.65)';
  ctx.font = `${scaledFontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  content.forEach((line, i) => {
    const y = tileH / 2 - textHeight / 2 + lineHeight * i + lineHeight / 2;
    ctx.fillText(line, tileW / 2, y);
  });

  return { dataUrl: canvas.toDataURL(), cssWidth: tileW / dpr, cssHeight: tileH / dpr };
}
