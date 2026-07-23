import { describe, expect, it } from 'vitest';
import type { DbExecutor } from '../../db/types';
import { cmsSites, cmsTemplates, cmsThemeDeployments } from '../../db/schema';
import { TaskCancelledError } from '../../lib/task-center';
import { assertCmsPublishFence } from './cms-site-publish-lock.service';

function executorFor(state: {
  themeRevision: number;
  templateRefsRevision: number;
  deploymentId: number | null;
  templateRevision: number;
}): DbExecutor {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === cmsSites) return [{
              themeRevision: state.themeRevision,
              templateRefsRevision: state.templateRefsRevision,
            }];
            if (table === cmsThemeDeployments) return state.deploymentId == null ? [] : [{ id: state.deploymentId }];
            if (table === cmsTemplates) return [{ revision: state.templateRevision }];
            return [];
          },
        }),
      }),
    }),
  } as unknown as DbExecutor;
}

describe('CMS publish revision fence', () => {
  it('lets only the newest lifecycle task reach the write switch', async () => {
    const state = { themeRevision: 2, templateRefsRevision: 4, deploymentId: 12, templateRevision: 7 };
    const executor = executorFor(state);
    let deployedRevision = 0;
    const run = async (expectedThemeRevision: number) => {
      await assertCmsPublishFence(executor, {
        siteId: 1,
        targetType: 'theme',
        expectedThemeRevision,
        expectedTemplateRefsRevision: 4,
        expectedDeploymentId: 12,
      });
      deployedRevision = expectedThemeRevision;
    };
    await run(2);
    await expect(run(1)).rejects.toBeInstanceOf(TaskCancelledError);
    expect(deployedRevision).toBe(2);
  });

  it('rejects changed references, deployment, and template lifecycle revisions', async () => {
    const executor = executorFor({ themeRevision: 2, templateRefsRevision: 5, deploymentId: null, templateRevision: 8 });
    await expect(assertCmsPublishFence(executor, {
      siteId: 1,
      targetType: 'template',
      templateId: 3,
      expectedThemeRevision: 2,
      expectedTemplateRefsRevision: 4,
      expectedDeploymentId: null,
      expectedTemplateLifecycleRevision: 8,
    })).rejects.toThrow(/templateRefsRevision/);
    await expect(assertCmsPublishFence(executor, {
      siteId: 1,
      targetType: 'template',
      templateId: 3,
      expectedThemeRevision: 2,
      expectedTemplateRefsRevision: 5,
      expectedDeploymentId: 9,
      expectedTemplateLifecycleRevision: 8,
    })).rejects.toThrow(/deployment/);
  });
});
