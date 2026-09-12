import { Tag } from '@douyinfe/semi-ui';
import { renderEnabledStatusTag } from '@/utils/table-columns';

export function IotEnabledTag({ status }: Readonly<{ status: 'enabled' | 'disabled' }>) {
  return renderEnabledStatusTag(status);
}

export function IotSuccessTag({ success }: Readonly<{ success: boolean }>) {
  return <Tag size="small" color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
}
