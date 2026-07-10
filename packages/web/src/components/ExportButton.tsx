import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dropdown, Space, SplitButtonGroup, Toast } from '@douyinfe/semi-ui';
import { ChevronDown, Download } from 'lucide-react';
import type { ExportJobCreateResult, ExportJobFormat, ExportJobRequestMode } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

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
  const [loadingFormat, setLoadingFormat] = useState<ExportJobFormat | null>(null);
  const isFlat = variant === 'flat';
  const buttonTheme = isFlat ? 'borderless' : undefined;
  const rootClassName = `export-button${isFlat ? ' export-button--flat' : ''}`;
  const exportMutation = useMutation({
    mutationFn: ({ format, resolvedQuery }: { format: ExportJobFormat; resolvedQuery: Record<string, unknown> }) =>
      request.post<ExportJobCreateResult>('/api/export-jobs', {
        entity,
        format,
        query: resolvedQuery,
        raw,
        watermark,
        executionMode,
      }).then(unwrap),
  });

  const runExport = async (format: ExportJobFormat) => {
    setLoadingFormat(format);
    try {
      const resolvedQuery = resolveQuery ? await resolveQuery(format) : (query ?? {});
      if (resolvedQuery == null) return;
      const { job, mode } = await exportMutation.mutateAsync({ format, resolvedQuery });
      if (job.status === 'success' && job.fileId) {
        await request.download(`/api/export-jobs/${job.id}/download`, job.filename ?? `${entity}.${format}`);
        Toast.success('导出完成');
        return;
      }
      Toast.success(mode === 'async' ? '导出任务已提交，可在导出中心查看进度' : '导出任务已创建');
    } finally {
      setLoadingFormat(null);
    }
  };

  if (formats.length <= 1) {
    const format = formats[0] ?? 'xlsx';
    return (
      <Button
        className={rootClassName}
        type="primary"
        theme={buttonTheme}
        icon={<Download size={14} />}
        loading={loadingFormat === format}
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
            loading={loadingFormat === format}
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
          loading={loadingFormat === 'xlsx'}
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
            loading={loadingFormat != null && loadingFormat !== 'xlsx'}
          />
        </Dropdown>
      </SplitButtonGroup>
    </span>
  );
}

export default ExportButton;
