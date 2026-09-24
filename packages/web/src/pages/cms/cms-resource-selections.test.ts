import { describe, expect, it } from 'vitest';
import { adoptCmsSavedResourceValues, createCmsResourceSelections } from './cms-resource-selections';

describe('CMS resource re-selection intent', () => {
  it('does not refresh a full autosave payload unless the user explicitly selected that resource', () => {
    const selections = createCmsResourceSelections();
    const payload = { coverImage: 'cms-res://1', mediaData: { mediaUrl: 'cms-res://2' } };
    expect([...selections.capture(payload)]).toEqual([]);
    selections.select(2);
    const saved = selections.capture(payload);
    expect([...saved.keys()]).toEqual([2]);
    selections.acknowledge(saved);
    expect([...selections.capture(payload)]).toEqual([]);
  });

  it('retains a newer selection made during a save and ignores a resource removed before saving', () => {
    const selections = createCmsResourceSelections();
    selections.select(2);
    const first = selections.capture({ mediaUrl: 'cms-res://2' });
    selections.select(2);
    selections.acknowledge(first);
    expect(selections.ids()).toEqual([2]);
    expect([...selections.capture({ mediaUrl: '' })]).toEqual([]);
    const resumed = createCmsResourceSelections();
    resumed.reset(selections.ids());
    expect([...resumed.capture({ mediaUrl: 'cms-res://2' }).keys()]).toEqual([2]);
  });

  it('adopts saved binary URLs without replacing new text, new media, or a repeated selection still pending', () => {
    const submitted = { title: '保存时标题', mediaUrl: 'cms-res://2', coverImage: 'cms-res://1', extend: { file: 'cms-res://3' } };
    const current = { ...submitted, title: '保存期间的标题', coverImage: 'cms-res://4' };
    const saved = { title: '保存时标题', mediaUrl: '/frozen-2.wav', coverImage: '/frozen-1.png', extend: { file: '/frozen-3.pdf' } };
    expect(adoptCmsSavedResourceValues(current, submitted, saved, new Set([3]))).toEqual({ title: '保存期间的标题', mediaUrl: '/frozen-2.wav', coverImage: 'cms-res://4', extend: { file: 'cms-res://3' } });
  });
});
