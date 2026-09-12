import { Tag } from '@douyinfe/semi-ui';

export function IotSuccessTag({ success }: Readonly<{ success: boolean }>) {
  return <Tag size="small" color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
}
