import { afterEach, describe, expect, it } from 'vitest';
import { mockCmsContents } from '@/mocks/data/cms';
import { cmsHandlers } from '@/mocks/handlers/cms';

const handlers = [...cmsHandlers];
const snapshot = structuredClone(mockCmsContents);

afterEach(() => {
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(snapshot));
});

async function call(path: string) {
  for (const handler of handlers) {
    const request = new Request(`${window.location.origin}${path}`, { method: 'GET' });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-calendar-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { data: unknown } };
  }
  throw new Error(`No handler matched GET ${path}`);
}

describe('CMS 内容日历 Mock', () => {
  it('按天聚合实际发布与计划发布 / 审稿截止 / 过期下线', async () => {
    const siteId = mockCmsContents[0].siteId;
    const [first, second] = mockCmsContents.filter((content) => content.siteId === siteId);
    // 直接发布的内容没有计划发布时间，只有实际发布时间：日历必须仍然看得到它
    first.publishedAt = '2026-09-10 09:00:00';
    first.scheduledAt = '2026-09-11 09:00:00';
    second.dueAt = '2026-09-10 18:00:00';
    second.expireAt = '2026-09-12 00:00:00';

    const res = await call(`/api/cms/contents/calendar?siteId=${siteId}&month=2026-09`);

    expect(res.status).toBe(200);
    const days = new Map((res.body.data as { date: string; counts: Record<string, number>; items: { contentId: number; kind: string }[] }[])
      .map((day) => [day.date, day]));
    expect(days.get('2026-09-10')?.counts).toEqual({ published: 1, scheduled: 0, due: 1, expire: 0 });
    expect(days.get('2026-09-10')?.items).toEqual(expect.arrayContaining([
      { contentId: first.id, title: first.title, kind: 'published' },
      { contentId: second.id, title: second.title, kind: 'due' },
    ]));
    expect(days.get('2026-09-11')?.items).toEqual([{ contentId: first.id, title: first.title, kind: 'scheduled' }]);
    expect(days.get('2026-09-12')?.items).toEqual([{ contentId: second.id, title: second.title, kind: 'expire' }]);
  });

  it('只返回所查月份，且跳过多余站点与已归档内容', async () => {
    const siteId = mockCmsContents[0].siteId;
    const [target] = mockCmsContents.filter((content) => content.siteId === siteId);
    const otherSite = mockCmsContents.find((content) => content.siteId !== siteId);
    target.publishedAt = '2026-09-20 10:00:00';
    if (otherSite) otherSite.publishedAt = '2026-09-20 10:00:00';
    const archived = mockCmsContents.filter((content) => content.siteId === siteId && content.id !== target.id)[0];
    if (archived) {
      archived.publishedAt = '2026-09-20 11:00:00';
      archived.archivedAt = '2026-09-21 00:00:00';
    }

    const september = await call(`/api/cms/contents/calendar?siteId=${siteId}&month=2026-09`);
    const day = (september.body.data as { date: string; counts: Record<string, number> }[]).find((entry) => entry.date === '2026-09-20');
    // 同日只有目标内容：异站点与已归档内容都不计入
    expect(day?.counts.published).toBe(1);

    const august = await call(`/api/cms/contents/calendar?siteId=${siteId}&month=2026-08`);
    expect(august.body.data).toEqual([]);
  });
});
