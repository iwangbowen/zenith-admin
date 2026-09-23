import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockCmsContents, mockCmsContentVersions } from './data/cms';
import {
  activateMockCmsRevision, assertMockCmsCas, bindMockCmsReview, freezeMockCmsRevision,
  getMockCmsDistributionConflict, getMockCmsPublishedContent, getMockCmsReviewContent, getMockCmsWorkingContent,
  mergeMockCmsDistribution, resetMockCmsRevisions, resolveMockCmsDistribution, restoreMockCmsRevision,
  saveMockCmsWorkingContent, setMockCmsDistributionBase,
} from './utils/cms-revisions';

const initialContents = structuredClone(mockCmsContents);
const initialVersions = structuredClone(mockCmsContentVersions);
function reset() {
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(initialContents));
  mockCmsContentVersions.splice(0, mockCmsContentVersions.length, ...structuredClone(initialVersions));
  resetMockCmsRevisions();
}
beforeEach(reset);
afterEach(reset);

describe('CMS Demo 修订一致性', () => {
  it('isolates saved work from public content and keeps later edits when activating the reviewed revision', () => {
    const content = getMockCmsWorkingContent(1);
    const oldPublicBody = getMockCmsPublishedContent(1)!.body;
    saveMockCmsWorkingContent(1, { body: '<p>送审正文</p>' }, content.version);
    expect(getMockCmsPublishedContent(1)!.body).toBe(oldPublicBody);
    const reviewed = freezeMockCmsRevision(1, 'submission');
    bindMockCmsReview(701, reviewed.id);
    saveMockCmsWorkingContent(1, { body: '<p>继续编辑的新稿</p>' }, content.version);
    expect(getMockCmsReviewContent(1, 701).body).toBe('<p>送审正文</p>');
    activateMockCmsRevision(reviewed.id);
    expect(getMockCmsPublishedContent(1)!.body).toBe('<p>送审正文</p>');
    expect(content.body).toBe('<p>继续编辑的新稿</p>');
    expect(content.hasUnpublishedChanges).toBe(true);
  });

  it('rejects stale writes and restores complete snapshot relationships into a new working version', () => {
    const content = getMockCmsWorkingContent(1);
    const original = freezeMockCmsRevision(1);
    const originalVersion = content.version;
    saveMockCmsWorkingContent(1, { titleStyle: { bold: true }, attachments: [{ name: '临时附件', url: '/temp.pdf', size: 1, ext: 'pdf', sort: 0 }], tagIds: [999], extraChannelIds: [3], relatedIds: [2] }, originalVersion);
    expect(() => assertMockCmsCas(1, originalVersion)).toThrow();
    restoreMockCmsRevision(1, original.id, content.version);
    for (const field of ['titleStyle', 'attachments', 'tagIds', 'extraChannelIds', 'relatedIds'] as const) expect(content[field]).toEqual(original.snapshot[field]);
    expect(content.version).toBeGreaterThan(originalVersion);
    expect(content.editorialStatus).toBe('draft');
  });

  it('surfaces three-way conflicts and applies the selected side without silently changing public content', () => {
    const source = getMockCmsWorkingContent(1);
    const target = getMockCmsWorkingContent(2);
    const baseline = structuredClone(source);
    saveMockCmsWorkingContent(target.id, { title: source.title, body: source.body }, target.version);
    setMockCmsDistributionBase(target.id, baseline);
    saveMockCmsWorkingContent(target.id, { body: '<p>目标自己的编辑</p>' }, target.version);
    const incoming = { ...baseline, body: '<p>来源更新</p>', version: baseline.version + 1 };
    expect(mergeMockCmsDistribution(target.id, incoming)).toBe(false);
    const conflict = getMockCmsDistributionConflict(target.id)!;
    expect(conflict.conflicts.find((item) => item.field === 'body')).toMatchObject({ base: baseline.body, target: '<p>目标自己的编辑</p>', incoming: '<p>来源更新</p>' });
    resolveMockCmsDistribution(target.id, conflict.version, Object.fromEntries(conflict.conflicts.map((item) => [item.field, 'target' as const])));
    expect(target.body).toBe('<p>目标自己的编辑</p>');
    expect(getMockCmsDistributionConflict(target.id)).toBeNull();
  });
});
