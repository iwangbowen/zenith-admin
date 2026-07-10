import { Button, Dropdown, Space, SplitButtonGroup } from '@douyinfe/semi-ui';
import { ChevronDown, Download } from 'lucide-react';
import type { ExportJobFormat, ExportJobRequestMode } from '@zenith/shared';
import { useExportJobRunner } from '@/hooks/useExportJobRunner';

interface ExportButtonProps {
  entity: string;
  query?: Record<string, unknown>;
  resolveQuery?: (format: ExportJobFormat) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  label?: string;
  formats?: ExportJobFormat[];
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
  variant?: 'primary' | 'flat';
}

export function ExportButton({
  entity,
  query,
  resolveQuery,
  label = '导出',
  formats = ['xlsx', 'csv'],
  raw = true,
  watermark = true,
  executionMode = 'sync',
  variant = 'primary',
}: Readonly<ExportButtonProps>) {
  const exportRunner = useExportJobRunner();
  const isFlat = variant === 'flat';
  const buttonTheme = isFlat ? 'borderless' : undefined;
  const rootClassName = `export-button${isFlat ? ' export-button--flat' : ''}`;

  const runExport = async (format: ExportJobFormat) => {
    const resolvedQuery = resolveQuery ? await resolveQuery(format) : (query ?? {});
    if (resolvedQuery == null) return;
    await exportRunner.runExport({
      entity,
      format,
      query: resolvedQuery,
      raw,
      watermark,
      executionMode,
    });
  };

  if (formats.length <= 1) {
    const format = formats[0] ?? 'xlsx';
    return (
      <Button
        className={rootClassName}
        type="primary"
        theme={buttonTheme}
        icon={<Download size={14} />}
        loading={exportRunner.isPending && exportRunner.pendingFormat === format}
        onClick={() => void runExport(format)}
      >
        {label}
      </Button>
    );
  }

  if (isFlat) {
    return (
      <Space vertical spacing={8} className={rootClassName} style={{ width: '100%' }}>
        {formats.map((format) => (
          <Button
            key={format}
            className="export-button__flat-item"
            type="primary"
            theme="borderless"
            icon={<Download size={14} />}
            loading={exportRunner.isPending && exportRunner.pendingFormat === format}
            onClick={() => void runExport(format)}
          >
            {label} {format.toUpperCase()}
          </Button>
        ))}
      </Space>
    );
  }

  return (
    <span className={rootClassName}>
      <SplitButtonGroup>
        <Button
          className="export-button__main"
          type="primary"
          theme={buttonTheme}
          icon={<Download size={14} />}
          loading={exportRunner.isPending && exportRunner.pendingFormat === 'xlsx'}
          onClick={() => void runExport('xlsx')}
        >
          {label}
        </Button>
        <Dropdown
          trigger="click"
          position="bottomRight"
          clickToHide
          render={(
            <Dropdown.Menu>
              {formats.map((format) => (
                <Dropdown.Item key={format} onClick={() => void runExport(format)}>
                  导出 {format.toUpperCase()}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          )}
        >
          <Button
            className="export-button__trigger"
            type="primary"
            theme={buttonTheme}
            icon={<ChevronDown size={14} />}
            loading={exportRunner.isPending && exportRunner.pendingFormat !== 'xlsx'}
          />
        </Dropdown>
      </SplitButtonGroup>
    </span>
  );
}

export default ExportButton;
