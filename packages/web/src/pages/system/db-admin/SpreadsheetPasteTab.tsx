import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Space, Toast, Typography } from '@douyinfe/semi-ui';
import { ClipboardPaste } from 'lucide-react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import type { FUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import { useThemeController } from '@/providers/theme-controller';
import '@univerjs/preset-sheets-core/lib/index.css';

const { Text } = Typography;

interface SpreadsheetPasteTabProps {
  /** 读取成功回调：headers 为列名（首行或自动生成），rows 为对象数组 */
  onData: (headers: string[], rows: Array<Record<string, unknown>>) => void;
}

/**
 * 电子表格粘贴导入：内嵌可编辑 Univer 表格，用户从 Excel/WPS 直接 Ctrl+V 粘贴，
 * 点击「读取表格数据」提取已用区域 → 交回 ImportModal 走统一映射/导入流程。
 */
export function SpreadsheetPasteTab({ onData }: Readonly<SpreadsheetPasteTabProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<FUniver | null>(null);
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const { isDark } = useThemeController();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      darkMode: isDark,
      locales: { [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN) },
      presets: [
        UniverSheetsCorePreset({
          container,
          header: false,
          toolbar: false,
          formulaBar: false,
          footer: false,
        }),
      ],
    });
    univerAPI.createWorkbook({ name: 'paste-import' });
    apiRef.current = univerAPI;
    return () => {
      apiRef.current = null;
      // Univer owns an internal React root; dispose after the parent commit finishes.
      queueMicrotask(() => univer.dispose());
    };
  }, [isDark]);

  const handleRead = () => {
    const api = apiRef.current;
    const sheet = api?.getActiveWorkbook()?.getActiveSheet();
    if (!sheet) {
      Toast.warning('表格尚未就绪');
      return;
    }
    const values = sheet.getDataRange().getValues();
    // 去掉全空行 / 全空列
    const nonEmpty = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
    const rows = values.filter((line) => line.some(nonEmpty));
    if (rows.length === 0) {
      Toast.warning('表格为空，请先从 Excel 粘贴数据（Ctrl+V）');
      return;
    }
    let lastCol = 0;
    for (const line of rows) {
      for (let c = line.length - 1; c >= 0; c--) {
        if (nonEmpty(line[c])) { lastCol = Math.max(lastCol, c + 1); break; }
      }
    }
    const grid = rows.map((line) => line.slice(0, lastCol));

    let headers: string[];
    let dataRows: Array<Array<unknown>>;
    if (firstRowHeader && grid.length > 1) {
      headers = grid[0].map((v, i) => {
        const s = v === null || v === undefined ? '' : String(v).trim();
        return s || `列${i + 1}`;
      });
      dataRows = grid.slice(1);
    } else {
      headers = Array.from({ length: lastCol }, (_, i) => `列${i + 1}`);
      dataRows = grid;
    }
    // 重名表头去重（col, col_2, ...）
    const seen = new Map<string, number>();
    headers = headers.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      return n === 1 ? h : `${h}_${n}`;
    });

    const objects = dataRows.map((line) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const v = line[i];
        obj[h] = v === undefined ? null : v;
      });
      return obj;
    });
    if (objects.length === 0) {
      Toast.warning('除表头外没有数据行');
      return;
    }
    onData(headers, objects);
    Toast.success(`已读取 ${objects.length} 行 × ${headers.length} 列`);
  };

  return (
    <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
      <Text type="tertiary" size="small">
        点击下方表格任意单元格，从 Excel / WPS 复制数据后 Ctrl+V 粘贴，再点「读取表格数据」。
      </Text>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: 320,
          border: '1px solid var(--semi-color-border)',
          borderRadius: 'var(--semi-border-radius-medium)',
          overflow: 'hidden',
        }}
      />
      <Space>
        <Button theme="solid" type="primary" icon={<ClipboardPaste size={14} />} onClick={handleRead}>
          读取表格数据
        </Button>
        <Checkbox checked={firstRowHeader} onChange={(e) => setFirstRowHeader(Boolean(e.target.checked))}>
          首行为列名
        </Checkbox>
      </Space>
    </Space>
  );
}

SpreadsheetPasteTab.displayName = 'SpreadsheetPasteTab';
