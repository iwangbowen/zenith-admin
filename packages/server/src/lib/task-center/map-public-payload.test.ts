import { describe, expect, it, vi } from 'vitest';
vi.mock('../ws-manager', () => ({ sendToUser: vi.fn() }));
import { publicAsyncTaskPayload } from './map';
describe('task publication payload boundary', () => {
  it('removes frozen drafts from public task payloads without changing worker input', () => {
    const payload = { siteId: 2, releaseId: 4, configurationCapture: { snapshot: { privateTitle: 'draft' } }, configurationCaptures: { 2: { privateBody: 'body' } } };
    expect(publicAsyncTaskPayload(payload)).toEqual({ siteId: 2, releaseId: 4 });
    expect(payload.configurationCapture.snapshot.privateTitle).toBe('draft');
    expect(payload.configurationCaptures[2].privateBody).toBe('body');
  });
});
