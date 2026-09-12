import { Tag } from '@douyinfe/semi-ui';
import type { SendSource, SendStatus } from '@zenith/shared/messaging';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS, SEND_SOURCE_OPTIONS as SOURCE_OPTIONS } from './send-log-constants';

export function SendStatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

/** 受控筛选控件的绑定形态，即 `useListSearch` 的 `bind('字段')` 返回值 */
interface FilterBinding<V> {
  readonly value: V | undefined;
  readonly onChange: (value: V | undefined) => void;
}

/**
 * 发送日志工具栏的「状态 + 来源」筛选对（邮件 / 短信日志共用）：
 * `<SendLogStatusSourceFilters status={bind('filterStatus')} source={bind('filterSource')} />`
 */
export function SendLogStatusSourceFilters({ status, source }: Readonly<{
  status: FilterBinding<SendStatus>;
  source: FilterBinding<SendSource>;
}>) {
  return (
    <>
      <StatusSelect items={STATUS_OPTIONS} {...status} />
      <FilterSelect placeholder="全部来源" items={SOURCE_OPTIONS} {...source} />
    </>
  );
}
