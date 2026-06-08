import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createUniver, LifecycleStages, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import type { IWorkbookData } from '@univerjs/presets';
import { useThemeController } from '@/providers/theme-controller';
import '@univerjs/preset-sheets-core/lib/index.css';

interface ExcelPreviewPanelProps {
  /** 后端 /sheet-preview 返回的 Univer 工作簿数据（IWorkbookData 子集） */
  readonly data: IWorkbookData;
  readonly style?: CSSProperties;
}

/**
 * Excel 只读预览面板：用 Univer 开源版渲染后端转换好的工作簿数据。
 * 关闭工具栏 / 公式栏 / 右键菜单，仅保留底部 sheet 切换标签，并禁用编辑。
 */
export function ExcelPreviewPanel({ data, style }: ExcelPreviewPanelProps) {
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

    // 在 Univer Rendered 生命周期阶段（canvas skeleton 已建立）后执行自适应行高命令，
    // 确保 generateMutationsOfAutoHeight 能正确测量文字高度。
    // 若当前已过 Rendered 阶段则立即执行（Steady 或更晚），否则等事件触发。
    const triggerAutoHeight = () => {
      const unitId = workbook.getId();
      workbook.getSheets().forEach((sheet) => {
        const subUnitId = sheet.getSheetId();
        const rowCount = sheet.getMaxRows();
        const colCount = sheet.getMaxColumns();
        univerAPI.executeCommand('sheet.command.set-row-is-auto-height', {
          unitId,
          subUnitId,
          ranges: [{ startRow: 0, endRow: rowCount - 1, startColumn: 0, endColumn: colCount - 1 }],
        });
      });
    };

    if (univerAPI.getCurrentLifecycleStage() >= LifecycleStages.Rendered) {
      triggerAutoHeight();
    } else {
      const disposable = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
        if (stage === LifecycleStages.Rendered) {
          triggerAutoHeight();
          disposable.dispose();
        }
      });
    }

    workbook.setEditable(false);

    return () => {
      univer.dispose();
    };
    // 数据/主题变化时重建实例（预览场景 data 单次注入，主题切换需重渲染）
  }, [data, isDark]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', ...style }} />
  );
}

export default ExcelPreviewPanel;
