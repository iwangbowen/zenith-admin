import { useMutation } from '@tanstack/react-query';
import { Toast } from '@douyinfe/semi-ui';
import type { ExportJobCreateResult, ExportJobFormat, ExportJobRequestMode } from '@zenith/shared';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

interface ExportJobRunOptions {
  entity: string;
  format: ExportJobFormat;
  query: Record<string, unknown>;
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
}

export function useExportJobRunner() {
  const exportMutation = useMutation({
    mutationFn: ({
      entity,
      format,
      query,
      raw = false,
      watermark = true,
      executionMode = 'sync',
    }: ExportJobRunOptions) =>
      request.post<ExportJobCreateResult>('/api/export-jobs', {
        entity,
        format,
        query,
        raw,
        watermark,
        executionMode,
      }).then(unwrap),
  });

  const runExport = async (options: ExportJobRunOptions) => {
    const { entity, format } = options;
    const { job, mode } = await exportMutation.mutateAsync(options);
    if (job.status === 'success' && job.fileId) {
      await request.download(`/api/export-jobs/${job.id}/download`, job.filename ?? `${entity}.${format}`);
      Toast.success('导出完成');
      return;
    }
    Toast.success(mode === 'async' ? '导出任务已提交，可在导出中心查看进度' : '导出任务已创建');
  };

  return {
    runExport,
    isPending: exportMutation.isPending,
    pendingFormat: exportMutation.variables?.format ?? null,
  };
}
