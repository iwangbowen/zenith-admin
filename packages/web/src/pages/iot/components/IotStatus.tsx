import { Tag } from '@douyinfe/semi-ui';

export function IotEnabledTag({ status }: Readonly<{ status: 'enabled' | 'disabled' }>) {
  return <Tag color={status === 'enabled' ? 'green' : 'red'} size="small">{status === 'enabled' ? '启用' : '禁用'}</Tag>;
}

export function IotSuccessTag({ success }: Readonly<{ success: boolean }>) {
  return <Tag size="small" color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
}
