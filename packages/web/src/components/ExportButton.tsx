import { useState } from 'react';
import { Button, Dropdown, SplitButtonGroup, Toast } from '@douyinfe/semi-ui';
import { ChevronDown, Download } from 'lucide-react';
import type { ExportJobCreateResult, ExportJobFormat, ExportJobRequestMode } from '@zenith/shared';
import { request } from '@/utils/request';

interface ExportButtonProps {
  entity: string;
  query?: Record<string, unknown>;
  label?: string;
  formats?: ExportJobFormat[];
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
}

export function ExportButton({
  entity,
  query,
  label = '导出',
  formats = ['xlsx', 'csv'],
  raw = true,
  watermark = true,
  executionMode = 'sync',
}: Readonly<ExportButtonProps>) {
  const [loadingFormat, setLoadingFormat] = useState<ExportJobFormat | null>(null);

  const runExport = async (format: ExportJobFormat) => {
    setLoadingFormat(format);
    try {
      const res = await request.post<ExportJobCreateResult>('/api/export-jobs', {
        entity,
        format,
        query: query ?? {},
        raw,
        watermark,
        executionMode,
      });
      if (res.code !== 0) return;
      const { job, mode } = res.data;
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
        type="primary"
        icon={<Download size={14} />}
        loading={loadingFormat === format}
        onClick={() => void runExport(format)}
      >
        {label}
      </Button>
    );
  }

  return (
    <SplitButtonGroup>
      <Button
        type="primary"
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
        <Button type="primary" icon={<ChevronDown size={14} />} loading={loadingFormat != null && loadingFormat !== 'xlsx'} />
      </Dropdown>
    </SplitButtonGroup>
  );
}

export default ExportButton;
