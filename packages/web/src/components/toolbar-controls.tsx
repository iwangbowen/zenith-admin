/**
 * 列表页搜索工具栏的标准按钮。
 *
 * 「查询 / 重置 / 新增」三个按钮在 140+ 个列表页里逐字复制了同一段 JSX
 * （type、icon、图标尺寸、文案全都一样），改一次样式就得改几百处。
 * 这里收敛为组件，配合 `SearchToolbar` 使用：
 *
 * @example
 * <SearchToolbar
 *   primary={<>{renderKeyword()}<SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} /></>}
 *   actions={hasPermission('system:role:create') ? <CreateButton onClick={openCreate} /> : null}
 * />
 */
import type { ReactNode } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { Ban, CircleCheck, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';

interface ToolbarButtonProps {
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** 覆盖默认文案（如「新增角色」「查询日志」） */
  readonly children?: ReactNode;
}

/** 主查询按钮（primary + 放大镜图标） */
export function SearchButton({ onClick, disabled, loading, children = '查询' }: ToolbarButtonProps) {
  return (
    <Button type="primary" icon={<Search size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {children}
    </Button>
  );
}

/** 条件重置按钮（tertiary + 回退图标） */
export function ResetButton({ onClick, disabled, loading, children = '重置' }: ToolbarButtonProps) {
  return (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {children}
    </Button>
  );
}

/**
 * 列表刷新按钮：与 `ResetButton` 视觉一致，但语义是「重新拉取数据」而非「清空筛选条件」。
 * 单独成组件，避免二者被同一次样式改动误伤。
 */
export function RefreshButton({ onClick, disabled, loading, children = '刷新' }: ToolbarButtonProps) {
  return (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {children}
    </Button>
  );
}

/** 新增按钮（primary + 加号图标）；是否渲染由调用方按权限判断 */
export function CreateButton({ onClick, disabled, loading, children = '新增' }: ToolbarButtonProps) {
  return (
    <Button type="primary" icon={<Plus size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {children}
    </Button>
  );
}

interface BatchDeleteButtonProps extends Omit<ToolbarButtonProps, 'children'> {
  /** 当前选中数，拼进文案 */
  readonly count: number;
  /** 覆盖默认文案「批量删除」，如「删除选中文件」 */
  readonly label?: ReactNode;
}

/**
 * 批量删除按钮（danger + 浅色 + 垃圾桶图标），文案带选中数。
 * 是否渲染由调用方按「有选中 && 有权限」判断——工具栏据此决定移动端是否出现「更多操作」菜单，组件内部不能自行返回 null。
 */
export function BatchDeleteButton({ count, onClick, disabled, loading, label = '批量删除' }: BatchDeleteButtonProps) {
  return (
    <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {label} ({count})
    </Button>
  );
}

interface BatchStatusButtonProps extends Omit<ToolbarButtonProps, 'children'> {
  /** 当前选中数，拼进文案 */
  readonly count: number;
  /** 覆盖默认文案（「批量启用」/「批量停用」），如「批量禁用」 */
  readonly label?: ReactNode;
}

/** 批量启用按钮（浅色 + 对勾图标），文案带选中数；渲染时机同 `BatchDeleteButton`，由调用方按「有选中 && 有权限」判断 */
export function BatchEnableButton({ count, onClick, disabled, loading, label = '批量启用' }: BatchStatusButtonProps) {
  return (
    <Button theme="light" icon={<CircleCheck size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {label} ({count})
    </Button>
  );
}

/** 批量停用 / 禁用按钮（浅色 warning + 禁止图标）；停用是破坏性语义（如禁用账号）时传 `danger` */
export function BatchDisableButton({ count, onClick, disabled, loading, label = '批量停用', danger = false }: BatchStatusButtonProps & { readonly danger?: boolean }) {
  return (
    <Button type={danger ? 'danger' : 'warning'} theme="light" icon={<Ban size={14} />} onClick={onClick} disabled={disabled} loading={loading}>
      {label} ({count})
    </Button>
  );
}

interface BatchStatusButtonsProps {
  readonly count: number;
  /** 通常是 `components/list-page` 的 `batchStatusHandler(...)` 返回值 */
  readonly onChange: (status: 'enabled' | 'disabled') => void | Promise<void>;
  /** 停用侧文案，如「批量禁用」 */
  readonly disableLabel?: ReactNode;
  readonly danger?: boolean;
  readonly loading?: boolean;
}

/** 「批量启用 + 批量停用」按钮对；是否渲染仍由调用方按「有选中 && 有权限」判断 */
export function BatchStatusButtons({ count, onChange, disableLabel, danger, loading }: BatchStatusButtonsProps) {
  return (
    <>
      <BatchEnableButton count={count} onClick={() => void onChange('enabled')} loading={loading} />
      <BatchDisableButton count={count} label={disableLabel} danger={danger} onClick={() => void onChange('disabled')} loading={loading} />
    </>
  );
}
