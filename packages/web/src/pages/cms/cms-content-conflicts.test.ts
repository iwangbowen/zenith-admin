import { describe, expect, it } from 'vitest';
import type { CmsModelField } from '@zenith/shared/cms';
import { mockCmsModels } from '@/mocks/data/cms';
import { buildCmsContentConflictRows, cmsConflictValueText } from './cms-content-conflicts';

const fieldBase = mockCmsModels.flatMap((model) => model.fields ?? [])[0];
const asForm = (record: Record<string, unknown>) => ({ ...record, titleBold: false, titleColor: '', mediaType: 'video', mediaUrl: '', mediaPoster: '', mediaDuration: '', albumImages: [] });

describe('内容冲突业务字段对照', () => {
  it('normalizes form fields and ignores AST, counters, audit data and unchanged business fields', () => {
    const base = { contentType: 'article', title: '原标题', body: '<p>正文</p>', channelId: 2, tagIds: [1, 2], titleStyle: { bold: true, color: '#ff0000' }, dueAt: '2026-10-01 09:00:00', viewCount: 1 };
    const server = { ...base, version: 99, bodyDocument: { nodes: ['不应显示'] }, viewCount: 999, updatedBy: 200, createdAt: '其他时间' };
    const local = { ...asForm(base), channelId: '2', tagIds: [2, 1], titleBold: true, titleColor: '#ff0000', dueAt: new Date(2026, 9, 1, 9) };
    expect(buildCmsContentConflictRows(base, server, local)).toEqual([]);
  });

  it('shows only changed fields with Chinese labels, safe body text and meaningful structured values', () => {
    const field: CmsModelField = { ...fieldBase, name: 'product', label: '产品信息', fieldType: 'object', configuration: { fields: [{ name: 'price', label: '价格', fieldType: 'number' }, { name: 'available', label: '可售', fieldType: 'switch' }] } };
    const base = { contentType: 'article', title: '旧标题', body: '<p>旧正文</p>', extend: { product: { price: 100, available: false } } };
    const server = { ...base, title: '服务端标题', body: '<p>服务端正文</p><script>alert(1)</script>', extend: { product: { price: 200, available: false } }, bodyDocument: { id: '内部结构' }, likeCount: 99 };
    const local = { ...asForm(base), title: '本地标题', extend: { product: { price: 300, available: true } } };
    const rows = buildCmsContentConflictRows(base, server, local, [field]);
    expect(rows.map((row) => row.key)).toEqual(['title', 'body', 'extend.product']);
    expect(rows.map((row) => row.label)).toEqual(['标题', '正文', '产品信息']);
    expect(rows[0].change).toBe('both');
    expect(cmsConflictValueText(rows[1], rows[1].server)).toBe('服务端正文');
    expect(cmsConflictValueText(rows[2], rows[2].local)).toBe('价格：300，可售：是');
  });

  it('does not report custom date controls or temporary media form keys as different values', () => {
    const field: CmsModelField = { ...fieldBase, name: 'deadline', label: '日期字段', fieldType: 'date' };
    const base = { contentType: 'media', mediaData: { mediaType: 'audio', mediaUrl: '/audio.mp3', poster: '/cover.png', duration: '03:00' }, extend: { deadline: '2026-10-01' } };
    const local = { ...asForm(base), mediaType: 'audio', mediaUrl: '/audio.mp3', mediaPoster: '/cover.png', mediaDuration: '03:00', extend: { deadline: new Date(2026, 9, 1) } };
    expect(buildCmsContentConflictRows(base, base, local, [field])).toEqual([]);
  });
});
