import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { renderAsync } from 'docx-preview';
import './DocxPreviewPanel.css';

interface DocxPreviewPanelProps {
  readonly blob: Blob;
  readonly style?: CSSProperties;
}

/**
 * Word(.docx) 只读预览面板：使用 docx-preview 将 OOXML 渲染为 HTML。
 * 直接消费鉴权下载得到的 Blob，无需后端转换。
 */
export function DocxPreviewPanel({ blob, style }: DocxPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    renderAsync(blob, container, undefined, {
      // className 不传，使用默认 .docx-wrapper / .docx，与 DocxPreviewPanel.css 的覆盖选择器匹配
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: false,
      trimXmlDeclaration: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    }).catch(() => {
      if (container) {
        container.innerHTML =
          '<div style="padding:40px;text-align:center;color:var(--semi-color-text-2)">文档渲染失败</div>';
      }
    });
  }, [blob]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#ffffff',
        overflowY: 'auto',
        ...style,
      }}
    >
      <div ref={containerRef} />
    </div>
  );
}

export default DocxPreviewPanel;
