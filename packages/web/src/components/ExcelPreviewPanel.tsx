import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Typography } from '@douyinfe/semi-ui';
import { FileSpreadsheet, X } from 'lucide-react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import type { IWorkbookData } from '@univerjs/presets';
import { useThemeController } from '@/providers/theme-controller';
import '@univerjs/preset-sheets-core/lib/index.css';

const { Text } = Typography;

interface ExcelPreviewPanelProps {
  /** 后端 /sheet-preview 返回的 Univer 工作簿数据（IWorkbookData 子集） */
  readonly data: IWorkbookData;
  readonly fileName: string;
  readonly onClose: () => void;
  readonly style?: CSSProperties;
}

/**
 * Excel 只读预览面板：用 Univer 开源版渲染后端转换好的工作簿数据。
 * 关闭工具栏 / 公式栏 / 右键菜单，仅保留底部 sheet 切换标签，并禁用编辑。
 */
export function ExcelPreviewPanel({ data, fileName, onClose, style }: ExcelPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useThemeController();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      darkMode: isDark,
      locales: {
        [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN),
      },
      presets: [
        UniverSheetsCorePreset({
          container,
          header: false,
          toolbar: false,
          formulaBar: false,
          contextMenu: false,
          footer: { sheetBar: true, statisticBar: false, zoomSlider: true },
        }),
      ],
    });

    const workbook = univerAPI.createWorkbook(data);
    workbook.setEditable(false);

    return () => {
      univer.dispose();
    };
    // 数据/主题变化时重建实例（预览场景 data 单次注入，主题切换需重渲染）
  }, [data, isDark]);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--semi-color-bg-0)',
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
        <FileSpreadsheet size={15} style={{ color: '#1a7f37', flexShrink: 0 }} />
        <Text ellipsis={{ showTooltip: true }} style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}>
          {fileName}
        </Text>
        <X
          size={18}
          style={{ cursor: 'pointer', color: 'var(--semi-color-text-2)', flexShrink: 0 }}
          onClick={onClose}
        />
      </div>

      {/* Univer 渲染容器 */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
    </div>
  );
}

export default ExcelPreviewPanel;
