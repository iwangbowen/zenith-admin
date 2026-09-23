import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents } from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import { ensureCmsPublishedShortLink } from './cms-short-link.service';
import { pushCmsPublishedContent } from './cms-push.service';
import { awardContributionPoints } from './cms-member-interaction.service';
import { submitCmsMappingDistributionSideEffects } from './cms-distributions.service';

/** Delivery work is durable and runs only after the public generation was activated. */
export function registerCmsPublicationEffectTasks() {
  registerTaskHandler({ taskType: 'cms-publication-effects', title: 'CMS 内容交付', module: 'CMS内容管理', allowConcurrent: true, maxAttempts: 3, retryDelayMs: 30_000,
    async run(ctx) {
      const id = Number(ctx.payload.contentId);
      const [content] = await db.select().from(cmsContents).where(eq(cmsContents.id, id)).limit(1);
      if (!content || content.version !== Number(ctx.payload.contentVersion)) return { skipped: true, reason: '公开内容已进入更新版本' };
      const checkpoint = { ...ctx.checkpoint };
      const step = async (name: string, action: () => Promise<unknown>) => {
        if (checkpoint[name]) return;
        await action();
        checkpoint[name] = true;
        await ctx.progress({ processed: Object.keys(checkpoint).filter((key) => checkpoint[key] === true).length, total: 4, checkpoint });
      };
      if (content.status === 'published') {
        await step('points', () => awardContributionPoints(content));
        await step('shortLink', () => ensureCmsPublishedShortLink(id));
        await step('searchPush', () => pushCmsPublishedContent(id));
      }
      await step('distribution', () => submitCmsMappingDistributionSideEffects(id));
      return { contentId: id, version: content.version };
    },
  });
}
