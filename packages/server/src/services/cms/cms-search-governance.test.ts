import { describe, expect, it, vi } from 'vitest';
import { createCmsSearchWordSchema, SEED_CMS_SEARCH_WORDS } from '@zenith/shared';
import { loadCmsExtensionWords, normalizeCmsSearchDictionaryWord } from './cms-search-dictionary';
import { filterCmsSearchTokens } from './cms-search.service';

describe('CMS site search governance', () => {
  it('filters stop words and normalizes duplicate query/index tokens', () => {
    expect(filterCmsSearchTokens(
      ['Zenith', '的', 'CMS', 'zenith', '，', '平台'],
      new Set(['的']),
    )).toEqual(['zenith', 'cms', '平台']);
  });

  it('rejects whitespace/control dictionary tokens in shared and service boundaries', () => {
    for (const word of ['Zenith Admin', 'bad\nword', 'bad word', '***']) {
      expect(normalizeCmsSearchDictionaryWord(word)).toBeNull();
      expect(createCmsSearchWordSchema.safeParse({
        siteId: 1, word, type: 'extension', groupName: '测试', weight: 1000, status: 'enabled',
      }).success).toBe(false);
    }
    expect(SEED_CMS_SEARCH_WORDS[0].word).toBe('ZenithAdmin');
  });

  it('isolates a single loadDict failure and continues loading later words', () => {
    const loadDict = vi.fn()
      .mockImplementationOnce(() => { throw new Error('bad token'); })
      .mockImplementationOnce(() => undefined);
    const onError = vi.fn();
    const loaded = loadCmsExtensionWords(
      { loadDict } as Pick<import('@node-rs/jieba').Jieba, 'loadDict'>,
      [
        { id: 1, word: 'BrokenWord', weight: 1000 },
        { id: 2, word: 'GoodWord', weight: 1000 },
      ],
      onError,
    );
    expect(loaded).toBe(1);
    expect(loadDict).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
  });
});
