import type { ReactNode } from 'react';
import { Button, Dropdown, Space, Tooltip } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { MoreHorizontal } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ZENITH_OPERATION_COLUMN_SYMBOL, type ZenithOperationColumnMarker } from './table-column-meta';

type OperationColumnRecord = Data;
type OperationColumn<RecordType extends OperationColumnRecord> = ColumnProps<RecordType> & ZenithOperationColumnMarker;

export const OPERATION_COLUMN_KEY = 'operation';
const DEFAULT_OPERATION_COLUMN_WIDTH = 160;

export interface ResponsiveTableAction {
  key: string;
  label: ReactNode;
  onClick?: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  hidden?: boolean;
  dividerBefore?: boolean;
}

interface ResponsiveTableActionsProps {
  actions: ResponsiveTableAction[];
  desktopInlineKeys?: string[];
  menuAriaLabel?: string;
}

interface OperationColumnOptions<RecordType extends OperationColumnRecord> {
  actions: (record: RecordType) => ResponsiveTableAction[];
  width?: number;
  title?: ReactNode;
  desktopInlineKeys?: string[];
  menuAriaLabel?: string;
}

function visibleActions(actions: ResponsiveTableAction[]) {
  return actions.filter((action) => !action.hidden);
}

function runAction(action: ResponsiveTableAction) {
  if (action.disabled) return;
  void action.onClick?.();
}

function renderActionMenu(actions: ResponsiveTableAction[]) {
  const items: ReactNode[] = [];

  actions.forEach((action, index) => {
    if (action.dividerBefore && index > 0) {
      items.push(<Dropdown.Divider key={`${action.key}-divider`} />);
    }
    items.push(
      <Dropdown.Item
        key={action.key}
        type={action.danger ? 'danger' : undefined}
        disabled={action.disabled}
        onClick={() => runAction(action)}
      >
        {action.label}
      </Dropdown.Item>,
    );
  });

  return <Dropdown.Menu>{items}</Dropdown.Menu>;
}

function ActionMenuButton({
  actions,
  ariaLabel,
}: Readonly<{
  actions: ResponsiveTableAction[];
  ariaLabel: string;
}>) {
  if (actions.length === 0) return null;

  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      clickToHide
      render={renderActionMenu(actions)}
    >
      <Button
        theme="borderless"
        size="small"
        icon={<MoreHorizontal size={14} />}
        aria-label={ariaLabel}
        title={ariaLabel}
      />
    </Dropdown>
  );
}

function InlineActionButton({ action }: Readonly<{ action: ResponsiveTableAction }>) {
  const button = (
    <Button
      theme="borderless"
      type={action.danger ? 'danger' : undefined}
      size="small"
      disabled={action.disabled}
      onClick={() => runAction(action)}
    >
      {action.label}
    </Button>
  );

  if (!action.disabled || !action.disabledReason) return button;

  return (
    <Tooltip content={action.disabledReason}>
      <span className="responsive-table-actions__tooltip-wrap">{button}</span>
    </Tooltip>
  );
}

export function ResponsiveTableActions({
  actions,
  desktopInlineKeys,
  menuAriaLabel = '更多操作',
}: Readonly<ResponsiveTableActionsProps>) {
  const isMobile = useIsMobile();
  const filteredActions = visibleActions(actions);

  if (filteredActions.length === 0) {
    return <span className="table-cell-placeholder">—</span>;
  }

  if (isMobile) {
    return (
      <div className="responsive-table-actions responsive-table-actions--mobile">
        <ActionMenuButton actions={filteredActions} ariaLabel={menuAriaLabel} />
      </div>
    );
  }

  const inlineKeySet = desktopInlineKeys ? new Set(desktopInlineKeys) : null;
  const inlineActions = inlineKeySet
    ? filteredActions.filter((action) => inlineKeySet.has(action.key))
    : filteredActions;
  const menuActions = inlineKeySet
    ? filteredActions.filter((action) => !inlineKeySet.has(action.key))
    : [];

  return (
    <Space className="responsive-table-actions" spacing={4}>
      {inlineActions.map((action) => (
        <InlineActionButton key={action.key} action={action} />
      ))}
      <ActionMenuButton actions={menuActions} ariaLabel={menuAriaLabel} />
    </Space>
  );
}

export function createOperationColumn<RecordType extends OperationColumnRecord>({
  actions,
  width = DEFAULT_OPERATION_COLUMN_WIDTH,
  title = '操作',
  desktopInlineKeys,
  menuAriaLabel,
}: Readonly<OperationColumnOptions<RecordType>>): OperationColumn<RecordType> {
  return {
    key: OPERATION_COLUMN_KEY,
    title,
    fixed: 'right',
    [ZENITH_OPERATION_COLUMN_SYMBOL]: true,
    width,
    render: (_: unknown, record: RecordType) => (
      <ResponsiveTableActions
        actions={actions(record)}
        desktopInlineKeys={desktopInlineKeys}
        menuAriaLabel={menuAriaLabel}
      />
    ),
  };
}

export default ResponsiveTableActions;
