import { useCallback, useState, type ReactNode } from 'react';
import { Modal, Switch, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { confirmDanger } from '@/utils/confirm';

type RowKey = string | number;
type TextOf<T> = string | ((record: T) => string);

/** 切换前的确认弹窗配置；`danger` 为 true 时走红色实心确认按钮（`confirmDanger`） */
export interface StatusToggleConfirm extends Omit<ModalReactProps, 'onOk' | 'onCancel'> {
  danger?: boolean;
}

export interface UseStatusToggleOptions<T extends Data> {
  /** 记录主键，默认 `record.id` */
  getKey?: (record: T) => RowKey;
  /** 当前是否为启用态，默认 `record.status === 'enabled'` */
  isEnabled?: (record: T) => boolean;
  /** 执行切换：载荷形状由页面决定（通常是 `mutateAsync`），返回 Promise 以驱动行内 loading */
  toggle: (record: T, enabled: boolean) => Promise<unknown>;
  /** 停用前确认：返回弹窗配置则先确认，返回 null / undefined 直接执行 */
  confirmDisable?: (record: T) => StatusToggleConfirm | null | undefined;
  /** 启用前确认（少数场景） */
  confirmEnable?: (record: T) => StatusToggleConfirm | null | undefined;
  /** 开关不可用：无权限、内置记录等 */
  disabled?: boolean | ((record: T) => boolean);
  /** 成功提示，默认「已启用」/「已停用」；传 null 关闭对应提示 */
  messages?: { enabled?: TextOf<T> | null; disabled?: TextOf<T> | null };
}

export interface StatusToggleColumnOptions {
  /** 默认「状态」 */
  title?: ReactNode;
  /** 默认 80 */
  width?: number;
  /** 默认 `status`（列设置用作稳定键） */
  dataIndex?: string;
  /** 状态列紧贴操作列并固定右侧（规范默认），特殊布局可关闭 */
  fixed?: boolean;
}

export interface StatusToggleController<T extends Data> {
  /** 正在切换的记录键（行内 loading） */
  pendingKey: RowKey | null;
  /** 触发切换：按配置先弹确认，再执行 toggle 并提示 */
  request: (record: T, enabled: boolean) => void;
  /** 渲染单元格开关 */
  renderSwitch: (record: T) => ReactNode;
  /** 生成状态列 */
  column: (options?: StatusToggleColumnOptions) => ColumnProps<T>;
}

function resolveText<T extends Data>(text: TextOf<T> | null | undefined, fallback: string, record: T): string | null {
  if (text === null) return null;
  if (text === undefined) return fallback;
  return typeof text === 'function' ? text(record) : text;
}

/**
 * 列表页「状态」开关列：行内 loading、停用 / 启用前确认、成功提示三件事只写一次。
 *
 * 与载荷形状解耦——页面只提供 `toggle(record, enabled)`，`{ id, values }`、`{ params, body }`、批量接口都能接；
 * 停用确认的标题 / 内容仍由页面给出（具体文案比通用文案更能防误操作）。
 *
 * @example
 * const status = useStatusToggle<WikiTemplate>({
 *   toggle: (r, enabled) => save.mutateAsync({ id: r.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
 *   confirmDisable: (r) => ({ title: '确认停用', content: `停用后「${r.name}」将不再出现在模板选择中，确认停用？` }),
 *   disabled: !hasPermission('wiki:template:edit'),
 * });
 * const columns = [..., status.column(), createOperationColumn(...)];
 */
export function useStatusToggle<T extends Data>(options: UseStatusToggleOptions<T>): StatusToggleController<T> {
  const { getKey, isEnabled, toggle, confirmDisable, confirmEnable, disabled, messages } = options;
  const [pendingKey, setPendingKey] = useState<RowKey | null>(null);

  const keyOf = useCallback((record: T): RowKey => (getKey ? getKey(record) : (record as unknown as { id: RowKey }).id), [getKey]);
  const enabledOf = useCallback(
    (record: T): boolean => (isEnabled ? isEnabled(record) : (record as { status?: string }).status === 'enabled'),
    [isEnabled],
  );
  const disabledOf = useCallback(
    (record: T): boolean => (typeof disabled === 'function' ? disabled(record) : Boolean(disabled)),
    [disabled],
  );

  const run = useCallback(async (record: T, enabled: boolean) => {
    const key = keyOf(record);
    setPendingKey(key);
    try {
      await toggle(record, enabled);
      const message = enabled
        ? resolveText(messages?.enabled, '已启用', record)
        : resolveText(messages?.disabled, '已停用', record);
      if (message) Toast.success(message);
    } catch {
      // 请求层已统一提示错误
    } finally {
      setPendingKey((current) => (current === key ? null : current));
    }
  }, [keyOf, messages, toggle]);

  const request = useCallback((record: T, enabled: boolean) => {
    const confirm = enabled ? confirmEnable?.(record) : confirmDisable?.(record);
    if (!confirm) {
      void run(record, enabled);
      return;
    }
    const { danger, ...modalProps } = confirm;
    const open = danger ? confirmDanger : Modal.confirm;
    open({ ...modalProps, onOk: () => { void run(record, enabled); } });
  }, [confirmDisable, confirmEnable, run]);

  const renderSwitch = useCallback((record: T): ReactNode => (
    <Switch
      size="small"
      checked={enabledOf(record)}
      loading={pendingKey === keyOf(record)}
      disabled={disabledOf(record)}
      onChange={(checked) => request(record, checked)}
    />
  ), [disabledOf, enabledOf, keyOf, pendingKey, request]);

  const column = useCallback((columnOptions: StatusToggleColumnOptions = {}): ColumnProps<T> => ({
    title: columnOptions.title ?? '状态',
    dataIndex: columnOptions.dataIndex ?? 'status',
    width: columnOptions.width ?? 80,
    ...(columnOptions.fixed === false ? {} : { fixed: 'right' as const }),
    render: (_: unknown, record: T) => renderSwitch(record),
  }), [renderSwitch]);

  return { pendingKey, request, renderSwitch, column };
}
