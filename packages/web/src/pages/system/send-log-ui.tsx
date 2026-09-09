import { Tag } from '@douyinfe/semi-ui';
import type { SendStatus } from '@zenith/shared/messaging';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { SEND_LOG_STATUS_OPTIONS as STATUS_OPTIONS, SEND_SOURCE_OPTIONS as SOURCE_OPTIONS } from './send-log-constants';

export function SendStatusTag({ value }: Readonly<{ value: SendStatus }>) {
  const it = STATUS_OPTIONS.find((s) => s.value === value);
  return <Tag color={it?.color ?? 'grey'} type="light">{it?.label ?? value}</Tag>;
}

/** 发送日志工具栏的「状态 + 来源」筛选对（邮件 / 短信日志共用） */
export function SendLogStatusSourceFilters({ status, source, onStatusChange, onSourceChange }: Readonly<{
  status: SendStatus | undefined;
  source: string | undefined;
  onStatusChange: (value: SendStatus | undefined) => void;
  onSourceChange: (value: string | undefined) => void;
}>) {
  return (
    <>
      <StatusSelect items={STATUS_OPTIONS} value={status} onChange={(v) => onStatusChange(v as SendStatus | undefined)} />
      <FilterSelect placeholder="全部来源" items={SOURCE_OPTIONS} value={source} onChange={(v) => onSourceChange(v as string | undefined)} />
    </>
  );
}
