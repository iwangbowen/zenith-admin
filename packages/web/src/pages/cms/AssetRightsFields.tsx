import { Divider, Form, List, Typography } from '@douyinfe/semi-ui';
import { useCmsAssetVersions } from '@/hooks/queries/cms-resources';
import { formatBytes } from '@zenith/shared/core';

export default function AssetRightsFields({ resourceId }: Readonly<{ resourceId?: number }>) {
  const versions = useCmsAssetVersions(resourceId);
  return <>
    <Form.Input field="source" label="来源" maxLength={500} />
    <Form.Input field="license" label="授权说明" maxLength={500} />
    <Form.DatePicker field="expiresAt" label="授权到期" type="dateTime" density="compact" showClear style={{ width: '100%' }} />
    <Form.Switch field="revoked" label="撤销授权" extraText="撤销后相关内容停止源站公开访问，CDN 刷新进度可在任务中心查看。" />
    <Form.TextArea field="alt" label="默认替代文本" maxLength={1000} />
    <Form.TagInput field="tags" label="素材标签" />
    <Divider align="left">文件版本</Divider>
    <List loading={versions.isLoading} dataSource={versions.data ?? []} emptyContent="尚无固定文件版本" renderItem={(item) => <List.Item>
      <div><Typography.Text link={{ href: item.url, target: '_blank', rel: 'noopener noreferrer' }}>版本 {item.version}</Typography.Text><Typography.Paragraph type="tertiary">{item.createdAt} · {formatBytes(item.size)} · {item.mimeType ?? ''}</Typography.Paragraph></div>
    </List.Item>} />
  </>;
}
