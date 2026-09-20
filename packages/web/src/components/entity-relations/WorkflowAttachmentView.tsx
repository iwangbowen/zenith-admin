import { Button, Space, Spin, Typography } from '@douyinfe/semi-ui';
import { useEntityWorkflowAttachment } from '@/hooks/queries/entity-relations';
import FileAttachment from '@/components/FileAttachment';

/** Metadata and content are independently authorized through the workflow boundary. */
export default function WorkflowAttachmentView({ id }: { readonly id: number }) {
  const query = useEntityWorkflowAttachment(id);
  if (query.isLoading) return <Spin size="small" />;
  if (!query.data || query.isError) return <Space><Typography.Text type="danger">附件不可用或无权查看</Typography.Text><Button onClick={() => void query.refetch()}>重试</Button></Space>;
  const file = query.data;
  return <FileAttachment mode="view" showTitle={false} value={[{ id: file.id, fileId: file.fileId, sortOrder: 0, createdAt: '',
    file: { id: file.fileId, originalName: file.name, size: file.size, mimeType: file.mimeType, extension: file.name.includes('.') ? file.name.split('.').at(-1)! : null, url: file.url } }]} />;
}
