import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsPageBlock } from '@zenith/shared/cms';
import type { DbExecutor } from '../../db/types';
import { cmsChannels, cmsContents, cmsPages, cmsTags, cmsWidgets, cmsWidgetRefs } from '../../db/schema';
import { resolveEffectivelyEnabledChannelIds } from './cms-channel-visibility.service';
import { sanitizeCmsPageBlocks } from './cms-page-blocks';

/** Runs against the candidate executor, never against a later working configuration. */
export async function assertCmsReleaseDependencies(executor: DbExecutor, siteId: number): Promise<void> {
  const [pages, widgets, channels, tags, placements] = await Promise.all([
    executor.select().from(cmsPages).where(and(eq(cmsPages.siteId, siteId), eq(cmsPages.status, 'enabled'))),
    executor.select().from(cmsWidgets).where(eq(cmsWidgets.siteId, siteId)),
    executor.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId)),
    executor.select({ slug: cmsTags.slug }).from(cmsTags).where(eq(cmsTags.siteId, siteId)),
    executor.select().from(cmsWidgetRefs).where(and(eq(cmsWidgetRefs.siteId, siteId), eq(cmsWidgetRefs.ownerType, 'theme_slot'))),
  ]);
  const enabledChannels = resolveEffectivelyEnabledChannelIds(channels);
  const widgetById = new Map(widgets.map((row) => [row.id, row]));
  const requireWidget = (id: number, owner: string) => {
    const widget = widgetById.get(id);
    if (!widget || widget.status !== 'published' || !widget.publishedData) throw new HTTPException(409, { message: `${owner} 引用的部件 #${id} 未包含在候选公开集合中，请将依赖一并加入发布单` });
  };
  for (const placement of placements) requireWidget(placement.widgetId, `主题插槽 ${placement.field}`);
  for (const page of pages) {
    const blocks = sanitizeCmsPageBlocks(page.blocks) as CmsPageBlock[];
    for (const block of blocks) {
      if (block.type === 'widget-ref') requireWidget(Number(block.props.widgetId), `页面「${page.name}」`);
      if (block.type === 'content-list') {
        const channel = typeof block.props.channelCode === 'string' && block.props.channelCode
          ? channels.find((row) => row.code === block.props.channelCode)
          : block.props.channelId ? channels.find((row) => row.id === Number(block.props.channelId)) : undefined;
        if ((block.props.channelCode || block.props.channelId) && (!channel || !enabledChannels.has(channel.id))) throw new HTTPException(409, { message: `页面「${page.name}」引用的栏目不存在或未启用` });
        if (block.props.tagSlug && !tags.some((tag) => tag.slug === block.props.tagSlug)) throw new HTTPException(409, { message: `页面「${page.name}」引用的标签不存在` });
      }
    }
  }
  for (const widget of widgets.filter((row) => row.status === 'published' && row.publishedData)) {
    const items = widget.publishedData!.items;
    const ids = items.filter((item) => item.sourceType === 'content').map((item) => item.sourceId).filter((id): id is number => typeof id === 'number');
    const contents = ids.length ? await executor.select().from(cmsContents).where(and(eq(cmsContents.siteId, siteId), inArray(cmsContents.id, ids))) : [];
    for (const item of items) {
      if (item.sourceType === 'channel' && !enabledChannels.has(Number(item.sourceId))) throw new HTTPException(409, { message: `部件「${widget.name}」引用了不存在或未启用的栏目` });
      if (item.sourceType === 'content') {
        const content = contents.find((row) => row.id === item.sourceId);
        if (!content || content.status !== 'published' || content.deletedAt || content.archivedAt || (content.expireAt && content.expireAt <= new Date()) || !enabledChannels.has(content.channelId)) throw new HTTPException(409, { message: `部件「${widget.name}」引用的内容 #${item.sourceId} 不在候选公开集合中` });
      }
    }
  }
}
