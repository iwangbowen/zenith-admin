import { describe, expect, it } from 'vitest';
import type { DbExecutor } from '../../db/types';
import { cmsSiteInheritances, cmsSites, cmsTemplates } from '../../db/schema';
import { TaskCancelledError } from '../../lib/task-center';
import { assertCmsPublishFence } from './cms-site-publish-lock.service';

function executorFor(state: {
  themeRevision: number;
  templateRefsRevision: number;
  deploymentId: number | null;
  templateRevision: number;
}): DbExecutor {
  return {
    query: {
      cmsThemeDeployments: {
        findFirst: async () => state.deploymentId == null ? undefined : {
          id: state.deploymentId,
          siteId: 1,
          themeCode: 'default',
          status: 'active',
          themePackageId: 1,
          themePackage: { id: 1, version: '1.0.0' },
        },
      },
    },
    select: () => ({
      from: (table: unknown) => {
        const rows = table === cmsSites ? [{
              id: 1,
              parentId: null,
              name: 'Site',
              code: 'site',
              theme: 'default',
              themeRevision: state.themeRevision,
              templateRefsRevision: state.templateRefsRevision,
              settings: {},
              status: 'enabled',
            }]
          : table === cmsSiteInheritances ? []
            : table === cmsTemplates ? [{ revision: state.templateRevision }]
              : [];
        const chain = {
          where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      },
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
