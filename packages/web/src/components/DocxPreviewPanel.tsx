import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Typography } from '@douyinfe/semi-ui';
import { FileText, X } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { useThemeController } from '@/providers/theme-controller';
import './DocxPreviewPanel.css';

const { Text } = Typography;

interface DocxPreviewPanelProps {
  readonly blob: Blob;
  readonly fileName: string;
  readonly onClose: () => void;
  readonly style?: CSSProperties;
}

/**
 * Word(.docx) 只读预览面板：使用 docx-preview 将 OOXML 渲染为 HTML。
 * 直接消费鉴权下载得到的 Blob，无需后端转换。
 */
export function DocxPreviewPanel({ blob, fileName, onClose, style }: DocxPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useThemeController();

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
        display: 'flex',
        flexDirection: 'column',
        background: isDark ? '#1f1f1f' : '#f0f0f0',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* 顶栏：文件名 + 关闭 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-bg-1)',
          flexShrink: 0,
        }}
      >
        <FileText size={15} style={{ color: '#2b579a', flexShrink: 0 }} />
        <Text
          ellipsis={{ showTooltip: true }}
          style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}
        >
          {fileName}
        </Text>
        <X
          size={18}
          style={{ cursor: 'pointer', color: 'var(--semi-color-text-2)', flexShrink: 0 }}
          onClick={onClose}
        />
      </div>

      {/* docx-preview 渲染容器，垂直滚动 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}

export default DocxPreviewPanel;
