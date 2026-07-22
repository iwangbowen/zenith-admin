import { CMS_SEARCH_DICTIONARY_WORD_PATTERN } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';

export function normalizeCmsSearchDictionaryWord(word: string): string | null {
  const normalized = word.trim();
  return CMS_SEARCH_DICTIONARY_WORD_PATTERN.test(normalized) ? normalized : null;
}

export function assertCmsSearchDictionaryWord(word: string): string {
  const normalized = normalizeCmsSearchDictionaryWord(word);
  if (!normalized) {
    throw new HTTPException(400, {
      message: '词条仅允许字母、数字、中文及 _ + . # -，且不能包含空白',
    });
  }
  return normalized;
}

export function loadCmsExtensionWords(
  loader: Pick<import('@node-rs/jieba').Jieba, 'loadDict'>,
  rows: Array<{ id: number; word: string; weight: number }>,
  onError: (row: { id: number; word: string }, error: unknown) => void,
): number {
  let loaded = 0;
  for (const row of rows) {
    const word = normalizeCmsSearchDictionaryWord(row.word);
    if (!word) {
      onError(row, new Error('词条格式无效'));
      continue;
    }
    try {
      loader.loadDict(Buffer.from(`${word} ${row.weight} n\n`, 'utf8'));
      loaded += 1;
    } catch (error) {
      onError(row, error);
    }
  }
  return loaded;
}
