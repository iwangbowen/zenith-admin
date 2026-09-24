import { Banner, Button, Collapsible, Empty, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CMS_RELEASE_CHANGE_LABELS, CMS_RELEASE_CHANGE_OPERATIONS, cmsReleaseFieldLabel } from '@zenith/shared/cms';
import { ASYNC_TASK_STATUS_LABELS } from '@zenith/shared/tasks';
import { useCmsReleaseReview, useRecreateCmsRelease } from '@/hooks/queries/cms-workbench';
import { usePermission } from '@/hooks/usePermission';
import { confirmDanger } from '@/utils/confirm';
import CmsValueDiff from './CmsValueDiff';

export default function CmsReleaseReviewPanel({ releaseId, onRecreated, onPreview }: Readonly<{ releaseId: number; onRecreated: (id: number) => void; onPreview: (path: string) => void }>) {
  const query = useCmsReleaseReview(releaseId);
  const recreate = useRecreateCmsRelease();
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string>();
  const review = query.data;
  if (query.isError) return <Banner type="danger" description={query.error.message} />;
  if (!review) return <Typography.Text>正在整理变更与交付状态…</Typography.Text>;
  const stale = review.stale;
  return <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
    <Typography.Title heading={6}>变更审阅</Typography.Title>
    <Typography.Text type="secondary">相对比较版本 #{review.comparisonGenerationId ?? '首次上线'}，共 {review.changes.length} 项变更。当前线上版本 #{review.currentGenerationId ?? '未上线'}。</Typography.Text>
    {stale && hasPermission('cms:publish:build') ? <Banner type="warning" description={<Space wrap><span>线上版本已变化，请重新准备并审阅发布单。</span><Button size="small" loading={recreate.isPending} onClick={() => confirmDanger({ title: '重新准备发布单？', content: '内容继续采用选定修订；配置读取这些对象当前已保存的工作稿。新发布单需要重新审阅和构建，不会自动上线。', onOk: async () => { const next = await recreate.mutateAsync({ params: { id: releaseId }, body: { expectedGenerationId: review.currentGenerationId, expectedFingerprint: review.fingerprint } }); onRecreated(next.id); } })}>准备新发布单</Button></Space>} /> : null}
    {!review.changes.length ? <Empty description="所选内容与当前线上版本没有字段变化" /> : null}
    {review.changes.map((change, index) => {
      const key = `${change.kind}:${change.id}:${index}`;
      return <div key={key} style={{ width: '100%' }}>
        <Space wrap><Tag>{CMS_RELEASE_CHANGE_LABELS[change.kind]}</Tag><Tag color={change.operation === 'remove' ? 'red' : 'blue'}>{CMS_RELEASE_CHANGE_OPERATIONS[change.operation]}</Tag>
          <Button theme="borderless" onClick={() => setExpanded(expanded === key ? undefined : key)}>{change.title} · {change.fields.length} 个字段</Button>
          <Button size="small" theme="borderless" onClick={() => navigate(change.editPath)}>打开编辑对象</Button>
        </Space>
        <Collapsible isOpen={expanded === key}>{change.fields.map((field) => <div key={field.path} style={{ marginTop: 12 }}><Typography.Text strong>{cmsReleaseFieldLabel(field.path)}</Typography.Text><CmsValueDiff before={field.before} after={field.after} html={field.path === 'body' || field.path === 'page_content'} beforeLabel="比较版本" afterLabel="本次变更" /></div>)}</Collapsible>
      </div>;
    })}
    <Typography.Title heading={6}>检查与影响范围</Typography.Title>
    {review.checks.map((check, index) => <Banner key={`${check.code}:${index}`} type={check.severity === 'error' ? 'danger' : 'warning'} description={<Space wrap><span>{check.objectTitle ? `${check.objectTitle}：` : ''}{check.message}</span>{check.editPath ? <Button size="small" theme="borderless" onClick={() => navigate(check.editPath!)}>处理问题</Button> : null}</Space>} />)}
    {review.wholeSiteAffected ? <Typography.Text>包含站点、导航或共享部件变更，将检查整站展示影响。</Typography.Text> : null}
    <Space wrap>{review.affectedPaths.map((path) => <Button key={path} size="small" onClick={() => onPreview(path)}>{path}</Button>)}</Space>
    <Typography.Title heading={6}>构建与后续交付</Typography.Title>
    {!review.tasks.length ? <Typography.Text type="tertiary">尚未生成交付任务</Typography.Text> : review.tasks.map((task) => <Space key={task.id} wrap>
      <Tag>{ASYNC_TASK_STATUS_LABELS[task.status]}</Tag><Typography.Text>{task.title}</Typography.Text>
      {task.totalCount != null ? <Typography.Text type="tertiary">{task.processedCount}/{task.totalCount}</Typography.Text> : null}
      <Typography.Text type={task.errorMessage ? 'danger' : 'tertiary'}>{task.errorMessage || task.progressNote}</Typography.Text>
    </Space>)}
  </Space>;
}
