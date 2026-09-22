import { Button, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { businessFileContract } from '@zenith/shared/platform';
import { useApiQuery } from '@/lib/contract-query';
import FileAttachment from '@/components/FileAttachment';

/** Safe metadata and file content both re-authorize an existing business attachment. */
export default function ManagedBusinessFileView({ fileId }: { readonly fileId: string }) {
  const query = useApiQuery(businessFileContract.managedDetail, { params: { fileId } }, { retry: false });
  if (query.isLoading) return <Spin size="small" />;
  if (!query.data || query.isError) return <Space><Typography.Text type="danger">附件不可用或无权查看</Typography.Text><Button onClick={() => void query.refetch()}>重试</Button></Space>;
  const file = query.data;
  return <FileAttachment mode="view" showTitle={false} value={[{ id: 0, fileId: file.id, sortOrder: 0, createdAt: file.createdAt, file }]} />;
}
