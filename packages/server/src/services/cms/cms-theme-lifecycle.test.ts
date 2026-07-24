import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const state = {
    site: { id: 1, name: 'Review Site', theme: 'default', themeRevision: 0, templateRefsRevision: 0 },
    pkg: null as Record<string, unknown> | null,
    deployment: null as Record<string, unknown> | null,
    tasks: [] as Array<Record<string, unknown>>,
    failTaskInsert: false,
    nextTaskId: 1,
    templateActive: true,
    healthChecks: 0,
  };
  const tables: Record<string, unknown> = {};
  const enqueueAsyncTask = vi.fn(async () => undefined);
  const submitCmsPublishTask = vi.fn();
  let transactionTail = Promise.resolve();

  function transactionExecutor() {
    let deploymentSelectCount = 0;
    const rowsFor = (table: unknown) => {
      if (table === tables.cmsSites) return [state.site];
      if (table === tables.cmsThemePackages) return state.pkg ? [state.pkg] : [];
      if (table === tables.cmsThemeDeployments) {
        const current = state.deployment;
        const first = deploymentSelectCount++ === 0;
        if (!current) return [];
        if (first) return current.status === 'active' ? [current] : [];
        return [current];
      }
      return [];
    };
    const select = vi.fn(() => ({
      from: (table: unknown) => {
        const rows = () => rowsFor(table);
        const chain: Record<string, unknown> = {};
        chain.where = () => chain;
        chain.for = () => chain;
        chain.orderBy = () => chain;
        chain.limit = async () => rows();
        chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(rows()).then(resolve, reject);
        return chain;
      },
    }));
    const update = vi.fn((table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          let result: Record<string, unknown> | undefined;
          const apply = () => {
            if (result) return result;
            if (table === tables.cmsSites) {
              state.site = {
                ...state.site,
                ...patch,
                themeRevision: state.site.themeRevision + (patch.themeRevision ? 1 : 0),
              };
              result = state.site;
            } else if (table === tables.cmsThemeDeployments && state.deployment) {
              state.deployment = { ...state.deployment, ...patch };
              result = state.deployment;
            } else if (table === tables.cmsThemePackages && state.pkg) {
              state.pkg = { ...state.pkg, ...patch };
              result = state.pkg;
            } else {
              result = {};
            }
            return result;
          };
          return {
            returning: async () => [apply()],
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(apply()).then(resolve, reject),
          };
        },
      }),
    }));
    const insert = vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const apply = () => {
          if (table === tables.cmsThemeDeployments) {
            state.deployment = {
              id: 1,
              status: 'active',
              activatedAt: new Date(),
              deactivatedAt: null,
              ...values,
            };
          }
          return state.deployment;
        };
        return {
          returning: async () => [{ id: Number(apply()?.id ?? 1) }],
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(apply()).then(resolve, reject),
        };
      },
    }));
    return { select, update, insert, execute: vi.fn(async () => undefined) };
  }

  const db = {
    query: {
      cmsThemePackages: {
        findFirst: vi.fn(async () => state.pkg),
      },
    },
    transaction: vi.fn((callback: (tx: ReturnType<typeof transactionExecutor>) => Promise<unknown>) => {
      const run = async () => {
        const snapshot = structuredClone({
          site: state.site,
          pkg: state.pkg,
          deployment: state.deployment,
          tasks: state.tasks,
          nextTaskId: state.nextTaskId,
        });
        try {
          return await callback(transactionExecutor());
        } catch (error) {
          state.site = snapshot.site;
          state.pkg = snapshot.pkg;
          state.deployment = snapshot.deployment;
          state.tasks = snapshot.tasks;
          state.nextTaskId = snapshot.nextTaskId;
          throw error;
        }
      };
      const result = transactionTail.then(run, run);
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
  };

  return {
    state,
    tables,
    db,
    enqueueAsyncTask,
    submitCmsPublishTask,
    resetTail: () => { transactionTail = Promise.resolve(); },
  };
});

vi.mock('../../db', () => ({ db: runtime.db }));
vi.mock('../../lib/task-center', () => ({ enqueueAsyncTask: runtime.enqueueAsyncTask }));
vi.mock('../../lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('../../cms/themes/registry', () => ({ isThemeRegistered: (code: string) => ['default', 'docs'].includes(code) }));
vi.mock('./cms-channels.service', () => ({ assertAllCmsSiteChannelsAccess: vi.fn(async () => undefined) }));
vi.mock('./cms-template-refs.service', () => ({
  getSiteTemplateHealth: vi.fn(async () => {
    runtime.state.healthChecks += 1;
    return {
      invalidRefs: runtime.state.healthChecks > 1 && !runtime.state.templateActive
        ? [{ source: 'content', kind: 'detail', template: 'detail-main', location: '内容详情模板' }]
        : [],
    };
  }),
}));
vi.mock('./cms-template-resolution.service', () => ({
  packageTemplateOptions: (pkg: { manifest: { templates: Array<{ type: string; code: string; name: string }> } }, type: string) =>
    pkg.manifest.templates.filter((item) => item.type === type).map((item) => ({ name: item.code, label: item.name })),
  resolveAvailableCmsTemplateNames: vi.fn(async () => ({
    themeAvailable: true,
    list: new Set<string>(),
    detail: new Set<string>(),
  })),
}));
vi.mock('./cms-site-inheritance.service', () => ({
  resolveEffectiveCmsSite: vi.fn(async () => ({
    raw: runtime.state.site,
    site: runtime.state.site,
    chain: [runtime.state.site],
    inheritance: {},
    sourceSiteIds: { theme: 1 },
  })),
  listCmsInheritanceAffectedSiteIds: vi.fn(async () => [1]),
  getCmsEffectiveThemeDeployment: vi.fn(async () => ({
    resolved: { site: runtime.state.site },
    themeSourceSiteId: 1,
    deployment: runtime.state.deployment?.status === 'active' ? runtime.state.deployment : null,
  })),
}));
vi.mock('./cms-sites.service', () => ({
  assertSiteAccess: vi.fn(async () => undefined),
  assertSitesAccess: vi.fn(async () => undefined),
  invalidateSiteCache: vi.fn(),
}));
vi.mock('./cms-themes.service', () => ({
  getCmsThemePackage: vi.fn(async () => ({ id: 10, code: 'review-theme', version: '1.0.0' })),
}));
vi.mock('./cms-publishing.service', () => ({ submitCmsPublishTask: runtime.submitCmsPublishTask }));

import { cmsSites, cmsThemeDeployments, cmsThemePackages } from '../../db/schema';
import {
  activateCmsThemePackage,
  deactivateCmsThemeForSite,
  setCmsThemePackageStatus,
} from './cms-theme-lifecycle.service';

const requiredTypes = ['index', 'list', 'detail', 'page', 'search', 'tag', 'not_found'] as const;

describe('CMS theme lifecycle transaction behavior', () => {
  beforeEach(() => {
    runtime.resetTail();
    runtime.state.site = { id: 1, name: 'Review Site', theme: 'default', themeRevision: 0, templateRefsRevision: 0 };
    runtime.state.pkg = {
      id: 10,
      code: 'review-theme',
      name: 'Review Theme',
      version: '1.0.0',
      status: 'validated',
      validationReport: { valid: true },
      manifest: {
        templates: requiredTypes.map((type) => ({ type, code: `${type}-main`, name: type, path: `templates/${type}.json` })),
      },
    };
    runtime.state.deployment = null;
    runtime.state.tasks = [];
    runtime.state.nextTaskId = 1;
    runtime.state.templateActive = true;
    runtime.state.healthChecks = 0;
    runtime.state.failTaskInsert = false;
    runtime.tables.cmsSites = cmsSites;
    runtime.tables.cmsThemePackages = cmsThemePackages;
    runtime.tables.cmsThemeDeployments = cmsThemeDeployments;
    runtime.enqueueAsyncTask.mockClear();
    runtime.submitCmsPublishTask.mockReset();
    runtime.submitCmsPublishTask.mockImplementation(async (_input, options) => {
      if (!options?.executor) throw new Error('task must use lifecycle transaction executor');
      if (runtime.state.failTaskInsert) throw new Error('simulated task insert failure');
      const task = { id: runtime.state.nextTaskId++, taskType: 'cms-publish-build', status: 'pending' };
      runtime.state.tasks.push(task);
      return task;
    });
  });

  it('rolls back the theme/deployment mutation when pending task persistence fails', async () => {
    runtime.state.failTaskInsert = true;
    await expect(activateCmsThemePackage(10, 1)).rejects.toThrow('simulated task insert failure');
    expect(runtime.state.site).toMatchObject({ theme: 'default', themeRevision: 0 });
    expect(runtime.state.deployment).toBeNull();
    expect(runtime.state.tasks).toHaveLength(0);
    expect(runtime.enqueueAsyncTask).not.toHaveBeenCalled();
  });

  it('serializes concurrent duplicate activation and creates one task for that revision', async () => {
    const results = await Promise.allSettled([
      activateCmsThemePackage(10, 1),
      activateCmsThemePackage(10, 1),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(runtime.state.site).toMatchObject({ theme: 'review-theme', themeRevision: 1 });
    expect(runtime.state.tasks).toHaveLength(1);
    expect(runtime.enqueueAsyncTask).toHaveBeenCalledTimes(1);
    expect(runtime.submitCmsPublishTask).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedThemeRevision: 1,
        expectedTemplateRefsRevision: 0,
        expectedDeploymentId: 1,
      }),
      expect.objectContaining({ executor: expect.anything() }),
    );
  });

  it('preserves activate, deactivate and reactivate as three distinct pending rebuild events', async () => {
    await activateCmsThemePackage(10, 1);
    await deactivateCmsThemeForSite(1, 'review-theme', 10);
    await activateCmsThemePackage(10, 1);
    expect(runtime.state.site).toMatchObject({ theme: 'review-theme', themeRevision: 3 });
    expect(runtime.state.deployment).toMatchObject({ status: 'active', themePackageId: 10 });
    expect(runtime.state.tasks).toHaveLength(3);
    expect(runtime.enqueueAsyncTask).toHaveBeenCalledTimes(3);
  });

  it('never commits a disabled package together with an active deployment during a race', async () => {
    const results = await Promise.allSettled([
      activateCmsThemePackage(10, 1),
      setCmsThemePackageStatus(10, 'disabled'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(runtime.state.pkg?.status === 'disabled' && runtime.state.deployment?.status === 'active').toBe(false);
  });

  it('rejects stale deactivation without changing the site theme', async () => {
    await activateCmsThemePackage(10, 1);
    await expect(deactivateCmsThemeForSite(1, 'review-theme', 99)).rejects.toMatchObject({ status: 409 });
    expect(runtime.state.site).toMatchObject({ theme: 'review-theme', themeRevision: 1 });
    expect(runtime.state.deployment).toMatchObject({ status: 'active', themePackageId: 10 });
    expect(runtime.state.tasks).toHaveLength(1);
  });

  it('rechecks dependencies under the global lifecycle lock after a concurrent template deactivation', async () => {
    runtime.state.templateActive = false;
    await expect(activateCmsThemePackage(10, 1)).rejects.toMatchObject({ status: 400 });
    expect(runtime.state.healthChecks).toBeGreaterThanOrEqual(2);
    expect(runtime.state.site).toMatchObject({ theme: 'default', themeRevision: 0 });
    expect(runtime.state.tasks).toHaveLength(0);
  });
});
