import { Toast } from '@douyinfe/semi-ui';
import { exportJobContract, type ExportJobFormat, type ExportJobRequestMode } from '@zenith/shared/tasks';
import { urlOf, useApiMutation } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { exportJobKeys } from '@/hooks/queries/export-jobs';

interface ExportJobRunOptions {
  entity: string;
  format: ExportJobFormat;
  query: Record<string, unknown>;
  columns?: string[];
  scope?: 'filtered' | 'page' | 'selected';
  rowIds?: Array<string | number>;
  idempotencyKey?: string;
  splitRows?: number;
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
}

export function useExportJobRunner() {
  const exportMutation = useApiMutation(exportJobContract.create, { invalidate: (qc) => void qc.invalidateQueries({ queryKey: exportJobKeys.lists }) });

  const runExport = async (options: ExportJobRunOptions) => {
    const { entity, format, query, columns, scope, rowIds, idempotencyKey, splitRows, raw = false, watermark = true, executionMode = 'auto' } = options;
    const { job, mode } = await exportMutation.mutateAsync({ body: { entity, format, query, columns, scope, rowIds, idempotencyKey, splitRows, raw, watermark, executionMode } });
    if (job.status === 'success' && job.fileId) {
      await request.download(urlOf(exportJobContract.download, { params: { id: job.id } }), job.filename ?? `${entity}.${format}`);
      Toast.success('已开始下载');
      return;
    }
    Toast.success(mode === 'async' ? '导出任务已提交，可在导出中心查看进度' : '导出任务已创建');
  };

  return {
    runExport,
    isPending: exportMutation.isPending,
    pendingFormat: exportMutation.variables?.body.format ?? null,
  };
}
