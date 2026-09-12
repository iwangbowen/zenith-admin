import type { ReactNode } from 'react';
import { Modal, Toast } from '@douyinfe/semi-ui';
import { confirmDanger } from '@/utils/confirm';

export type BatchStatus = 'enabled' | 'disabled';

export interface BatchStatusOptions<Id extends string | number = number> {
  /** 当前选中的行键（`useRowSelection().selectedRowKeys`） */
  readonly selectedRowKeys: readonly Id[];
  /** 成功后清空选中（`useRowSelection().clear`） */
  readonly clearSelection: () => void;
  /** 执行批量写入；载荷形状（`{ ids, status }` / `{ ids, enabled }`）由页面适配 */
  readonly run: (ids: Id[], status: BatchStatus) => Promise<unknown>;
  /** 停用侧文案：「停用」（默认）或「禁用」 */
  readonly disableLabel?: string;
  /**
   * 何时弹确认框：`'disable'`（默认，只有停用需要确认）/ `'always'` / `'never'`。
   * 标题缺省为「确认批量{启用 / 停用}选中的 N {entity}？」
   */
  readonly confirm?: 'disable' | 'always' | 'never';
  /** 确认标题里的量词 + 名词，如「个数据集」「条短链」；缺省「项」 */
  readonly entity?: string;
  readonly confirmContent?: (status: BatchStatus, count: number) => ReactNode | undefined;
  /** 停用是破坏性语义（如禁用账号）时确认按钮用红色实心 */
  readonly danger?: boolean;
  /** 成功提示，缺省「批量{启用 / 停用}成功」 */
  readonly successMessage?: (status: BatchStatus, count: number) => string;
}

/**
 * 「批量启用 / 停用」的统一流程：空选中直接返回 → 按策略确认 → 执行 → 清空选中 → 成功提示。
 * 返回 `handleBatchStatus(status)`，交给 `BatchEnableButton` / `BatchDisableButton` 的 `onClick`。
 *
 * @example
 * const handleBatchStatus = batchStatusHandler({
 *   selectedRowKeys, clearSelection,
 *   run: (ids, status) => batchStatusMutation.mutateAsync({ body: { ids, status } }),
 *   confirm: 'always', entity: '个数据集',
 * });
 * <BatchEnableButton count={selectedRowKeys.length} onClick={() => handleBatchStatus('enabled')} />
 */
export function batchStatusHandler<Id extends string | number = number>({
  selectedRowKeys,
  clearSelection,
  run,
  disableLabel = '停用',
  confirm = 'disable',
  entity = '项',
  confirmContent,
  danger = false,
  successMessage,
}: BatchStatusOptions<Id>) {
  return async (status: BatchStatus): Promise<void> => {
    const ids = [...selectedRowKeys];
    if (ids.length === 0) return;
    const label = status === 'enabled' ? '启用' : disableLabel;
    const execute = async () => {
      await run(ids, status);
      clearSelection();
      Toast.success(successMessage?.(status, ids.length) ?? `批量${label}成功`);
    };
    const needConfirm = confirm === 'always' || (confirm === 'disable' && status === 'disabled');
    if (!needConfirm) return execute();
    const options = {
      title: `确认批量${label}选中的 ${ids.length} ${entity}？`,
      content: confirmContent?.(status, ids.length),
      onOk: execute,
    };
    // 停用是破坏性语义时用红色实心确认（confirmDanger），否则普通确认
    if (danger && status === 'disabled') confirmDanger(options);
    else Modal.confirm(options);
  };
}
