import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
const state = vi.hoisted(() => ({ permissions: new Set<string>(), rows: [] as unknown[], management: new Map<string, { canManage: boolean }>(), blockedSite: 0 }));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows, then: (resolve: (rows: unknown[]) => unknown) => resolve(state.rows) }) }) }) } }));
vi.mock('../../lib/context', () => ({ hasPermission: async (key: string) => state.permissions.has(key) }));
vi.mock('./cms-page-acl.service', () => ({ resolveCmsPageBlockManagement: async () => state.management }));
vi.mock('./cms-content-access.service', () => ({ requireCmsContentsAccess: async () => [] }));
vi.mock('./cms-channels.service', () => ({ assertChannelAccess: async () => undefined }));
vi.mock('./cms-sites.service', () => ({ assertSiteAccess: async (id: number) => { if (id === state.blockedSite) throw new HTTPException(403); } }));
import { decorateCmsPreviewEditTargets } from './cms-preview-edit-targets';

beforeEach(() => { state.permissions.clear(); state.rows = []; state.management.clear(); state.blockedSite = 0; });
describe('authorized preview edit targets', () => {
  it('does not expose an inherited widget editor when its owning site is inaccessible', async () => {
    state.permissions.add('cms:widget:list'); state.permissions.add('cms:widget:update'); state.blockedSite = 5;
    state.rows = [{ id: 8, siteId: 5, name: 'Inherited' }];
    const result = await decorateCmsPreviewEditTargets(4, '/__cms/test', { status: 200, kind: 'home', html: '<section data-cms-placement="widget" data-cms-block-id="8">Widget</section>' });
    expect(result.editTargets).toEqual([]);
  });
});
