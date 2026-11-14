import { useRef, type ReactNode } from 'react';
import type { AsyncTask } from '@zenith/shared/tasks';
import { useUploadFile } from '@/hooks/queries/files';
import { useSubmitImportJob } from '@/hooks/queries/import-jobs';

export interface ImportSubmitTarget {
  /** 导入实体标识（服务端 Definition 的 entity） */
  entity: string;
  /** 实体上下文参数（如 CMS 内容导入的 siteId / channelId） */
  context?: Record<string, unknown>;
}

export interface UseImportUploadOptions {
  /** 文件选定后决定提交目标；返回 null 表示取消（未选实体 / 前置校验不通过） */
  resolveTarget: () => ImportSubmitTarget | null;
  onSubmitted: (task: AsyncTask, dryRun: boolean) => void;
  onPrepared?: (prepared: { fileId: string; dryRun: boolean; fileName: string; entity: string; context?: Record<string, unknown> }) => void;
  inspectBeforeSubmit?: boolean;
}

/**
 * 导入文件选择 → 上传文件中心 → 提交导入任务 的公共流程（`ImportButton` 与导入中心「新建导入」共用）。
 * 返回隐藏的 file input 节点（调用方渲染到任意位置）、按「正式 / 预检」拉起选择器的 `pickFile`，
 * 以及上传 / 提交中的状态；模板下载与进度展示由调用方自行编排。
 */
export function useImportUpload({ resolveTarget, onSubmitted, onPrepared, inspectBeforeSubmit = false }: UseImportUploadOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dryRunRef = useRef(false);
  const uploadMutation = useUploadFile();
  const submitMutation = useSubmitImportJob();

  async function handleFileSelected(file: File) {
    const target = resolveTarget();
    if (!target) return;
    const formData = new FormData();
    formData.append('file', file);
    const uploaded = await uploadMutation.mutateAsync({ formData, visibility: 'restricted' });
    const fileId = uploaded[0]?.id;
    if (!fileId) return;
    if (inspectBeforeSubmit) {
      onPrepared?.({ fileId, dryRun: dryRunRef.current, fileName: file.name, entity: target.entity, context: target.context });
      return;
    }
    const row = await submitMutation.mutateAsync({
      body: { entity: target.entity, fileId, dryRun: dryRunRef.current, ...(target.context === undefined ? {} : { context: target.context }) },
    });
    onSubmitted(row, dryRunRef.current);
  }

  function pickFile(dryRun: boolean) {
    dryRunRef.current = dryRun;
    fileInputRef.current?.click();
  }

  const fileInput: ReactNode = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".xlsx,.csv"
      style={{ display: 'none' }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) void handleFileSelected(file);
      }}
    />
  );

  return {
    fileInput,
    pickFile,
    submitting: uploadMutation.isPending || submitMutation.isPending,
    /** 当前这次选择是否为预检 */
    isDryRun: () => dryRunRef.current,
    submitPrepared: async (prepared: { fileId: string; entity: string; context?: Record<string, unknown>; dryRun: boolean }, options?: { fieldMapping?: Record<string, string>; duplicateMode?: 'error' | 'skip' }) => {
      const row = await submitMutation.mutateAsync({ body: { entity: prepared.entity, fileId: prepared.fileId, dryRun: prepared.dryRun, duplicateMode: options?.duplicateMode ?? 'error', ...(prepared.context === undefined ? {} : { context: prepared.context }), ...(options?.fieldMapping ? { fieldMapping: options.fieldMapping } : {}) } });
      onSubmitted(row, prepared.dryRun);
    },
  };
}
