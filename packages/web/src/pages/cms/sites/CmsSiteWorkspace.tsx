import { Banner, Button, Card, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useCmsSiteDetail, useCmsChannelTree, useCmsPageList } from '@/hooks/queries/cms';
import { usePermission } from '@/hooks/usePermission';
import type { Permission } from '@zenith/shared/core';
import CmsConfigurationNotice from '../CmsConfigurationNotice';
import CmsWorkbenchPreview from '../CmsWorkbenchPreview';
import { useState } from 'react';

export default function CmsSiteWorkspace({ siteId, onEdit }: Readonly<{ siteId?: number; onEdit?: () => void }>) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const site = useCmsSiteDetail(siteId);
  const channels = useCmsChannelTree(hasPermission('cms:channel:list') ? siteId : undefined);
  const pages = useCmsPageList({ siteId: hasPermission('cms:page:list') ? siteId : undefined, page: 1, pageSize: 100 });
  const [preview, setPreview] = useState(false);
  if (!siteId) return null;
  const data = site.data;
  const sections = (data?.settings?.themeConfig as Record<string, unknown> | undefined)?.homeSections;
  const takeover = pages.data?.list.find((page) => page.isHome && page.status === 'enabled');
  const checks = [
    { name: '站点标题', done: !!data?.title, to: 'sites', permission: 'cms:site:list' },
    { name: '品牌标志', done: !!data?.logo, to: 'sites', permission: 'cms:site:list' },
    { name: '内容栏目', done: (channels.data?.length ?? 0) > 0, to: 'channels', permission: 'cms:channel:list' },
    { name: '首页编排', done: !!takeover || (Array.isArray(sections) && sections.length > 0), to: takeover ? 'pages' : 'sites', permission: 'cms:site:list' },
  ];
  return <Card title={`${data?.name ?? '当前站点'} · 建站工作区`} style={{ marginBottom: 16 }}>
    {site.isError ? <Banner type="danger" description={site.error.message} /> : null}
    <Space wrap style={{ marginBottom: 12 }}>
      {([['channels', '栏目与导航', 'cms:channel:list'], ['contents', '内容', 'cms:content:list'], ['resources', '素材', 'cms:resource:list'], ['pages', '页面与首页', 'cms:page:list'], ['widgets', '页面部件', 'cms:widget:list'], ['models', '内容模型', 'cms:model:list'], ['forms', '表单', 'cms:form:list'], ['publishing', '发布记录', 'cms:publish:view']] as const).filter(([, , permission]) => hasPermission(permission as Permission)).map(([path, label]) => <Button key={path} onClick={() => navigate(`/cms/${path}?site=${siteId}&siteId=${siteId}`)}>{label}</Button>)}
      {onEdit && hasPermission('cms:site:update') ? <Button onClick={onEdit}>主题与站点设置</Button> : null}
      {hasPermission('cms:publish:view') ? <Button onClick={() => setPreview(true)}>组合预览站点工作稿</Button> : null}
    </Space>
    <Space wrap style={{ marginBottom: 12 }}>{checks.filter((item) => hasPermission(item.permission as Permission)).map((item) => <Button key={item.name} theme="borderless" onClick={() => item.to === 'sites' && onEdit ? onEdit() : navigate(`/cms/${item.to}?siteId=${siteId}`)}><Tag color={item.done ? 'green' : 'orange'}>{item.done ? '已配置' : '待完善'}</Tag> {item.name}</Button>)}</Space>
    {takeover ? <Typography.Paragraph type="secondary">首页由搭建页「{takeover.name}」接管，可进入页面与首页调整区块。主题首页编排在取消接管后生效。</Typography.Paragraph> : null}
    <CmsConfigurationNotice siteId={siteId} />
    <CmsWorkbenchPreview visible={preview} onClose={() => setPreview(false)} siteId={siteId} selection={{ includeSiteConfiguration: true }} />
  </Card>;
}
