import { describe, expect, it, vi } from 'vitest';
import { deferredRenderer, type BrowserRenderer } from './deferred-renderer';

const plugin = (rendererId: string, handler = vi.fn(async () => ({ $el: document.createElement('div'), destroy() {} }))): BrowserRenderer => ({
  id: rendererId, handlers: [{ rendererId, handler }],
});
const target = () => document.createElement('div');

describe('deferred format engines', () => {
  it('registers format metadata without importing engines, and only loads the requested format', async () => {
    const loadWord = vi.fn(async () => plugin('office-word-openxml'));
    const loadSpreadsheet = vi.fn(async () => plugin('spreadsheet-openxml'));
    const word = deferredRenderer('word', ['office-word-openxml'], loadWord);
    const sheet = deferredRenderer('sheet', ['spreadsheet-openxml'], loadSpreadsheet);
    expect(word.definitions?.[0].id).toBe('office-word-openxml');
    expect(sheet.definitions?.[0].id).toBe('spreadsheet-openxml');
    expect(loadWord).not.toHaveBeenCalled();
    expect(loadSpreadsheet).not.toHaveBeenCalled();
    const args = [new ArrayBuffer(1), target(), 'docx'] as const;
    await Promise.all([word.handlers![0].handler(...args), word.handlers![0].handler(...args)]);
    expect(loadWord).toHaveBeenCalledTimes(1);
    expect(loadSpreadsheet).not.toHaveBeenCalled();
  });
  it('preserves buffer, target, type and options when dispatching a format or nested archive entry', async () => {
    const wordHandler = vi.fn(async () => ({ $el: target(), destroy() {} }));
    const word = deferredRenderer('word', ['office-word-openxml'], async () => plugin('office-word-openxml', wordHandler));
    const archive = deferredRenderer('archive', ['archive'], async () => ({ id: 'archive', handlers: [{ rendererId: 'archive', handler: async (buffer, element, _type, context) => {
      expect(context?.options?.renderers).toEqual([word, archive]);
      await word.handlers![0].handler(buffer, element, 'docx', context);
      return { $el: element, destroy() {} };
    } }] }));
    const buffer = new ArrayBuffer(2), element = target();
    const context = { options: { renderers: [word, archive], locale: 'zh-CN' as const } };
    await archive.handlers![0].handler(buffer, element, 'zip', context);
    expect(wordHandler).toHaveBeenCalledWith(buffer, element, 'docx', context);
  });
  it('does not permanently cache a failed import and reports missing format contracts', async () => {
    const load = vi.fn<() => Promise<BrowserRenderer>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(plugin('geo'));
    const geo = deferredRenderer('geo', ['geo'], load);
    await expect(geo.handlers![0].handler(new ArrayBuffer(1), target())).rejects.toThrow('offline');
    await geo.handlers![0].handler(new ArrayBuffer(1), target());
    expect(load).toHaveBeenCalledTimes(2);
    expect(() => deferredRenderer('unknown', ['missing-format'], load)).toThrow('Missing file renderer definition');
    const missing = deferredRenderer('geo', ['geo'], async () => ({ id: 'invalid' }));
    await expect(missing.handlers![0].handler(new ArrayBuffer(1), target())).rejects.toThrow('Missing file renderer handler');
  });
});
