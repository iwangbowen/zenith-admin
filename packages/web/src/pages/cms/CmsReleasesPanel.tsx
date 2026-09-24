import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Banner, Button, Checkbox, DatePicker, Descriptions, Input, Select, SideSheet, Space, Switch, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { cmsContentContract, cmsReleaseContract, type CmsRelease } from '@zenith/shared/cms';
import { apiQueryOptions } from '@/lib/contract-query';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { ListSearchToolbar } from '@/components/list-page';
import { ModalFooter } from '@/components/ModalFooter';
import { CreateButton } from '@/components/toolbar-controls';
import { useListPage } from '@/hooks/useListPage';
import { usePermission } from '@/hooks/usePermission';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTimeForApi } from '@/utils/date';
import { confirmDanger } from '@/utils/confirm';
import { CmsSiteSelect } from './CmsSiteSelect';
import CmsContentReferenceInput from './CmsContentReferenceInput';
import CmsConfigurationPicker from './CmsConfigurationPicker';
import { useCmsReleaseList, useCmsReleaseDetail, useCmsReleasePreview, useCreateCmsRelease, useBuildCmsRelease, useActivateCmsRelease, useCancelCmsRelease, useRollbackCmsRelease } from '@/hooks/queries/cms-releases';

const RELEASE_LABELS: Record<CmsRelease['status'], string> = { draft: '草拟', building: '构建中', ready: '待激活', scheduled: '已排期', active: '已激活', failed: '失败', cancelled: '已取消', superseded: '历史部署' };
const RELEASE_COLORS: Record<CmsRelease['status'], 'grey' | 'orange' | 'blue' | 'green' | 'red'> = { draft: 'grey', building: 'blue', ready: 'orange', scheduled: 'blue', active: 'green', failed: 'red', cancelled: 'grey', superseded: 'grey' };

export default function CmsReleasesPanel() {
  const { hasPermission } = usePermission();
  const canBuild = hasPermission('cms:publish:build');
  const canManage = hasPermission('cms:publish:manage');
  const [siteId, setSiteId] = useState<number>();
  const [detailId, setDetailId] = useState<number>();
  useListDeepLink(['release', 'site'], (picked) => {
    if (Number.isSafeInteger(Number(picked.site)) && Number(picked.site) > 0) setSiteId(Number(picked.site));
    if (Number.isSafeInteger(Number(picked.release)) && Number(picked.release) > 0) setDetailId(Number(picked.release));
  });
  const detail = useCmsReleaseDetail(detailId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState('/');
  const [previewPathInput, setPreviewPathInput] = useState('/');
  const [mobilePreview, setMobilePreview] = useState(false);
  const preview = useCmsReleasePreview(detailId, previewPath, previewOpen);
  const page = useListPage({ contract: cmsReleaseContract, useList: useCmsReleaseList, params: { siteId: siteId ?? 0 }, enabled: !!siteId });
  const create = useCreateCmsRelease();
  const build = useBuildCmsRelease();
  const activate = useActivateCmsRelease();
  const cancel = useCancelCmsRelease();
  const rollback = useRollbackCmsRelease();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [contentIds, setContentIds] = useState<number[]>([]);
  const [withdrawIds, setWithdrawIds] = useState<number[]>([]);
  const [pageIds, setPageIds] = useState<number[]>([]);
  const [widgetIds, setWidgetIds] = useState<number[]>([]);
  const [includeSiteConfiguration, setIncludeSiteConfiguration] = useState(false);
  const [revisions, setRevisions] = useState<Record<number, number>>({});
  const [activateAt, setActivateAt] = useState<Date | undefined>();
  const [timeZone, setTimeZone] = useState('Asia/Shanghai');
  const [autoActivate, setAutoActivate] = useState(false);
  const selectedContents = useQueries({ queries: contentIds.map((id) => apiQueryOptions(cmsContentContract.detail, { params: { id } })) });
  const histories = useQueries({ queries: contentIds.map((id) => apiQueryOptions(cmsContentContract.versions, { params: { id }, query: { page: 1, pageSize: 200 } })) });
  const columns: ColumnProps<CmsRelease>[] = [
    { title: '发布单', dataIndex: 'name', minWidth: 230, render: (value, record) => <Space><span>{value}</span>{record.source === 'configuration' && record.status === 'draft' ? <Tag color="blue">配置变更汇总</Tag> : null}</Space> },
    // 「0 发布 / 0 撤下」在 120 定宽下会折行（内容宽约 124），按内容宽加宽并单行省略
    { title: '范围', width: 150, render: (_value, record) => renderEllipsis(`${record.items.filter((item) => item.action === 'publish').length} 发布 / ${record.items.filter((item) => item.action === 'withdraw').length} 撤下`) },
    { title: '排期', width: 220, render: (_value, record) => record.activateAt ? `${record.activateAt}（${record.timeZone}）` : record.autoActivate ? '构建成功后激活' : '手动激活' },
    { title: '公开代次', dataIndex: 'deploymentId', width: 110 },
    dateTimeColumn('创建时间', 'createdAt'),
    { title: '状态', dataIndex: 'status', width: 110, render: (status: CmsRelease['status']) => <Tag color={RELEASE_COLORS[status]}>{RELEASE_LABELS[status]}</Tag> },
    createOperationColumn<CmsRelease>({ width: 150, desktopInlineKeys: ['detail'], actions: (record) => [
      { key: 'detail', label: '查看', onClick: () => setDetailId(record.id) },
      { key: 'build', label: '构建', hidden: !['draft', 'failed'].includes(record.status) || !canBuild, onClick: () => void build.mutateAsync({ params: { id: record.id } }).then(() => setDetailId(record.id)) },
      { key: 'cancel', label: '取消', danger: true, hidden: ['active', 'superseded', 'cancelled'].includes(record.status) || !canManage, onClick: () => { confirmDanger({ title: '取消该发布单？', content: '当前线上部署保持不变。', onOk: () => cancel.mutateAsync({ params: { id: record.id } }) }); } },
    ] }),
  ];
  async function submit() {
    if (!siteId) return;
    const revisionIds = contentIds.map((id, index) => revisions[id] ?? selectedContents[index]?.data?.approvedRevisionId ?? selectedContents[index]?.data?.publishedRevisionId).filter((id): id is number => !!id);
    if (revisionIds.length !== contentIds.length) return;
    const release = await create.mutateAsync({ body: { siteId, name: name.trim(), revisionIds, withdrawContentIds: withdrawIds, pageIds, widgetIds, includeSiteConfiguration, activateAt: activateAt ? formatDateTimeForApi(activateAt) : null, timeZone, autoActivate } });
    setCreating(false);
    setDetailId(release.id);
  }
  return <>
    <Banner type="info" closeIcon={null} description="配置保存会合并到本站待构建的配置草稿；点击构建后冻结本次范围。内容批准表示修订可发布，构建并激活后才更新线上内容。" style={{ marginBottom: 12 }} />
    <ListSearchToolbar page={page} filters={['keyword']} extraFilters={<CmsSiteSelect value={siteId} onChange={(id) => { setSiteId(id); page.setPage(1); }} />} create={canBuild ? <CreateButton disabled={!siteId} onClick={() => { setName(''); setContentIds([]); setWithdrawIds([]); setPageIds([]); setWidgetIds([]); setIncludeSiteConfiguration(false); setRevisions({}); setActivateAt(undefined); setAutoActivate(false); setCreating(true); }}>新建发布单</CreateButton> : null} />
    <ConfigurableTable columns={columns} {...page.tableProps} />
    {/* 发布单包含远程修订选择与多种对象动作，属于复合编排表单。 */}
    <SideSheet title="新建发布单" visible={creating} onCancel={() => setCreating(false)} width={780} footer={<ModalFooter onCancel={() => setCreating(false)} onOk={() => void submit()} okText="冻结发布单" loading={create.isPending} disabled={!name.trim() || contentIds.some((id, index) => !(revisions[id] ?? selectedContents[index]?.data?.approvedRevisionId ?? selectedContents[index]?.data?.publishedRevisionId)) || withdrawIds.some((id) => contentIds.includes(id))} />}>
      <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
        <Input value={name} onChange={setName} placeholder="发布单名称，如秋季活动上线" maxLength={200} />
        <Typography.Title heading={6}>发布内容及固定修订</Typography.Title>
        <CmsContentReferenceInput siteId={siteId} multiple value={contentIds} onChange={(value) => setContentIds(Array.isArray(value) ? value : [])} />
        {contentIds.map((id, index) => {
          const content = selectedContents[index]?.data;
          const selected = revisions[id] ?? content?.approvedRevisionId ?? content?.publishedRevisionId;
          return <div key={id} style={{ width: '100%' }}><Typography.Text strong>{content?.title ?? '正在加载内容…'}</Typography.Text><Select style={{ width: '100%', marginTop: 6 }} value={selected ?? undefined} loading={histories[index]?.isFetching} placeholder="选择已经批准的修订" optionList={(histories[index]?.data?.list ?? []).map((revision) => ({ value: revision.id, label: `v${revision.version} · ${revision.title} · ${revision.createdAt}${revision.id === content?.approvedRevisionId ? ' · 已批准' : revision.id === content?.publishedRevisionId ? ' · 线上稿' : ''}`, disabled: revision.id !== content?.approvedRevisionId && revision.id !== content?.publishedRevisionId }))} onChange={(value) => setRevisions((previous) => ({ ...previous, [id]: Number(value) }))} />{!selected ? <Typography.Text type="warning">请先在内容编辑页完成审核或申请发布以生成可发布修订。</Typography.Text> : null}</div>;
        })}
        <Typography.Title heading={6}>撤下内容</Typography.Title>
        <CmsContentReferenceInput siteId={siteId} multiple value={withdrawIds} onChange={(value) => setWithdrawIds(Array.isArray(value) ? value : [])} />
        {withdrawIds.some((id) => contentIds.includes(id)) ? <Banner type="danger" description="同一内容不能同时发布与撤下" /> : null}
        <Typography.Title heading={6}>页面与站点配置</Typography.Title>
        {hasPermission('cms:page:list') ? <><Typography.Text>页面</Typography.Text><CmsConfigurationPicker kind="page" siteId={siteId} value={pageIds} onChange={setPageIds} /></> : null}
        {hasPermission('cms:widget:list') ? <><Typography.Text>页面部件</Typography.Text><CmsConfigurationPicker kind="widget" siteId={siteId} value={widgetIds} onChange={setWidgetIds} /></> : null}
        <Checkbox checked={includeSiteConfiguration} onChange={(event) => setIncludeSiteConfiguration(!!event.target.checked)}>一并冻结本站导航与公开配置</Checkbox>
        <Typography.Text type="tertiary">所选对象在创建发布单时冻结；后续编辑不会改变本次发布范围。</Typography.Text>
        <Typography.Title heading={6}>激活计划</Typography.Title>
        <Space wrap><Switch checked={autoActivate} onChange={setAutoActivate} /><Typography.Text>构建完成后自动激活</Typography.Text></Space>
        <Space wrap><DatePicker type="dateTime" value={activateAt} showClear onChange={(value) => setActivateAt(value instanceof Date ? value : undefined)} placeholder="可选：指定激活时间" /><Select value={timeZone} style={{ width: 220 }} onChange={(value) => setTimeZone(String(value))} optionList={['Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'].map((value) => ({ value, label: value }))} /></Space>
        <Typography.Text type="tertiary">时间按所选时区解释。留空表示不设置排期；创建后在详情中构建候选部署。</Typography.Text>
      </Space>
    </SideSheet>
    <SideSheet title="发布单详情" visible={!!detailId} onCancel={() => setDetailId(undefined)} width={820}>
      {detail.isError ? <Banner type="danger" description="发布单加载失败" /> : detail.data ? <Space vertical align="start" spacing={16} style={{ width: '100%' }}>
        <Typography.Title heading={5}>{detail.data.name}</Typography.Title>
        {detail.data.source === 'configuration' && detail.data.status === 'draft' ? <Banner type="info" description="本站后续配置保存会继续合并到这份草稿。确认变更范围后构建，构建后的发布单保持固定。" /> : null}
        <Tag color={RELEASE_COLORS[detail.data.status]}>{RELEASE_LABELS[detail.data.status]}</Tag>
        {/* 单列键值对：row（双行）模式会把值渲染成大字并让 64 位摘要溢出抽屉边界 */}
        <Descriptions data={[{ key: '当前公开代次', value: detail.data.activeGenerationId ?? '尚未上线' }, { key: '候选部署', value: detail.data.deploymentId ?? '待构建' }, { key: '基础代次', value: detail.data.baseGenerationId ?? '首次部署' }, { key: '排期', value: detail.data.activateAt ? `${detail.data.activateAt}（${detail.data.timeZone}）` : '无' }, { key: '产物数', value: detail.data.deployment?.artifactCount ?? 0 }, { key: '部署摘要', value: detail.data.deployment?.manifestHash ? <Typography.Text code style={{ wordBreak: 'break-all' }}>{detail.data.deployment.manifestHash}</Typography.Text> : '构建后生成' }]} />
        {detail.data.error ? <Banner type="danger" description={detail.data.error} /> : null}
        {detail.data.blockingChecks.map((message) => <Banner key={message} type="warning" description={message} />)}
        <Typography.Title heading={6}>已冻结的变更范围</Typography.Title>
        {detail.data.items.length ? detail.data.items.map((item) => <Space key={item.contentId} wrap><Tag color={item.action === 'withdraw' ? 'red' : 'blue'}>{item.action === 'withdraw' ? '撤下' : '发布'}</Tag><Typography.Text>{item.title}</Typography.Text>{item.revisionId ? <Typography.Text type="tertiary">固定修订 #{item.revisionId}</Typography.Text> : null}</Space>) : <Typography.Text type="tertiary">重建本站当前公开集合</Typography.Text>}
        {detail.data.configurationItems.map((item) => <Space key={`${item.kind}-${item.id}`} wrap><Tag>{item.kind === 'page' ? '页面' : item.kind === 'widget' ? '部件' : '站点配置'}</Tag><Typography.Text>{item.title}</Typography.Text></Space>)}
        <Space wrap>
          {canBuild && ['draft', 'failed'].includes(detail.data.status) ? <Button loading={build.isPending} onClick={() => void build.mutateAsync({ params: { id: detail.data!.id } })}>构建候选部署</Button> : null}
          {detail.data.deployment?.manifestHash ? <Button onClick={() => setPreviewOpen(true)}>预览固定部署</Button> : null}
          {canManage && ['ready', 'scheduled'].includes(detail.data.status) ? <Button type="primary" loading={activate.isPending} disabled={detail.data.blockingChecks.length > 0} onClick={() => confirmDanger({ title: '激活该发布单？', content: '源站将切换到该部署的固定公开集合。', onOk: () => activate.mutateAsync({ params: { id: detail.data!.id }, body: { expectedGenerationId: detail.data!.activeGenerationId } }) })}>激活到源站</Button> : null}
          {canManage && detail.data.status === 'superseded' ? <Button type="warning" loading={rollback.isPending} onClick={() => confirmDanger({ title: '恢复这个历史部署？', content: '系统将重新校验当前撤权和紧急门禁并保留激活记录。', onOk: () => rollback.mutateAsync({ params: { id: detail.data!.id }, body: { expectedGenerationId: detail.data!.activeGenerationId } }) })}>回滚到此部署</Button> : null}
        </Space>
        {detail.data.activations.map((entry) => <Typography.Text key={entry.id} type="secondary">{entry.createdAt} · {entry.operatorName} · {entry.action === 'rollback' ? '回滚' : '激活'} · {entry.fromGenerationId ?? '初始'} → {entry.toGenerationId}</Typography.Text>)}
      </Space> : <Typography.Text>正在加载…</Typography.Text>}
    </SideSheet>
    <SideSheet title="固定部署预览" visible={previewOpen && Boolean(detailId)} onCancel={() => setPreviewOpen(false)} width="90vw">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input value={previewPathInput} onChange={setPreviewPathInput} placeholder="页面路径，如 /news/example.html" style={{ width: 360 }} />
        <Button loading={preview.isFetching} onClick={() => { if (previewPathInput === previewPath) void preview.refetch(); else setPreviewPath(previewPathInput || '/'); }}>打开页面</Button>
        <Button theme={mobilePreview ? 'light' : 'solid'} onClick={() => setMobilePreview(false)}>桌面</Button>
        <Button theme={mobilePreview ? 'solid' : 'light'} onClick={() => setMobilePreview(true)}>手机</Button>
      </Space>
      {preview.error ? <Banner type="danger" description={preview.error.message} /> : null}
      {preview.data ? <iframe title="固定候选部署" sandbox="" srcDoc={preview.data.html} style={{ display: 'block', width: mobilePreview ? 375 : '100%', maxWidth: '100%', height: '72vh', border: 0, margin: '0 auto' }} /> : null}
    </SideSheet>
  </>;
}
