import type { ReactNode } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import type { ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { confirmDelete } from '@/utils/confirm';

export interface DeleteConfirmOptions<R = unknown> {
  /** 指明删除对象的标题，如「确定要删除模板「xxx」吗？」 */
  title: string;
  content?: ReactNode;
  okText?: string;
  /** 执行删除（通常是 `mutateAsync`）；reject 时弹窗保持打开、由请求层提示错误 */
  run: () => Promise<R>;
  /** 成功提示，默认「删除成功」；传 null 关闭；需要带上结果（如条数）时传函数 */
  successMessage?: string | null | ((result: R) => string);
  /** 成功后的收尾：清选中、关详情等 */
  onDeleted?: (result: R) => void;
}

/** 删除确认 + 执行 + 成功提示，供操作列动作、批量删除按钮与面板内的删除共用 */
export function confirmAndDelete<R = unknown>({ title, content, okText, run, successMessage, onDeleted }: DeleteConfirmOptions<R>) {
  confirmDelete({
    title,
    content,
    ...(okText ? { okText } : {}),
    onOk: async () => {
      const result = await run();
      if (successMessage !== null) {
        Toast.success(typeof successMessage === 'function' ? successMessage(result) : (successMessage ?? '删除成功'));
      }
      onDeleted?.(result);
    },
  });
}

export interface DeleteActionOptions<R = unknown> extends DeleteConfirmOptions<R> {
  /** 无权限时隐藏（不渲染动作） */
  hidden?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** 默认 `delete` */
  key?: string;
  /** 默认「删除」 */
  label?: ReactNode;
}

/**
 * 操作列里的「删除」动作：红色文字、点击弹 `confirmDelete`、确认后执行并提示。
 *
 * @example
 * createOperationColumn<Tag>({ width: 150, actions: (record) => [
 *   { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
 *   deleteAction({ hidden: !canDelete, title: `确定要删除标签「${record.name}」吗？`, run: () => remove.mutateAsync([record.id]) }),
 * ] })
 */
export function deleteAction<R = unknown>({ hidden, disabled, disabledReason, key, label, ...confirm }: DeleteActionOptions<R>): ResponsiveTableAction {
  return {
    key: key ?? 'delete',
    label: label ?? '删除',
    danger: true,
    hidden,
    disabled,
    disabledReason,
    onClick: () => confirmAndDelete(confirm),
  };
}
