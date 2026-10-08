import { beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderConfig = {
  providerId: string;
  baseUrl: string | null;
  apiKey: string;
  defaultModel: string;
  isEnabled: boolean;
};

const mocks = vi.hoisted(() => ({
  providerConfig: null as ProviderConfig | null,
}));

vi.mock('../../services/ai/ai-providers.service', () => ({
  getRawDefaultProviderConfig: vi.fn(async () => mocks.providerConfig),
}));

vi.mock('../ai/mastra-models', () => ({
  toMastraModel: vi.fn((source: ProviderConfig, model: string) => ({
    id: `${source.providerId}/${model}`,
    apiKey: source.apiKey,
  })),
}));

const { Mastra } = await import('@mastra/core/mastra');
const { ensureLlmScorers, registerCodeScorers } = await import('./scorers');

const LLM_SCORER_IDS = [
  'answer-similarity-scorer',
  'answer-relevancy-scorer',
  'toxicity-scorer',
  'bias-scorer',
] as const;

function createMastra(): InstanceType<typeof Mastra> {
  return new Mastra({});
}

type RegisteredScorer = {
  judge?: { model: unknown };
  run: (input: unknown) => Promise<{ score: number }>;
};

function scorerMap(mastra: InstanceType<typeof Mastra>): Record<string, RegisteredScorer> {
  return (mastra.listScorers() ?? {}) as Record<string, RegisteredScorer>;
}

beforeEach(() => {
  mocks.providerConfig = {
    providerId: 'test-provider',
    baseUrl: 'https://model.test/v1',
    apiKey: 'test-key',
    defaultModel: 'judge-a',
    isEnabled: true,
  };
});

describe('Mastra scorer registration', () => {
  it('runs the project code scorer through the current Mastra scorer API', async () => {
    const mastra = createMastra();
    await registerCodeScorers(mastra);

    const scorers = scorerMap(mastra);
    expect(scorers['ground-truth']).toBeDefined();
    const result = await scorers['ground-truth'].run({
      output: 'The answer contains the expected phrase.',
      groundTruth: 'expected phrase',
    });

    expect(result.score).toBe(1);
  });

  it('registers all four real evals prebuilt factories without invoking an external model', async () => {
    const mastra = createMastra();

    await expect(ensureLlmScorers(mastra)).resolves.toBe(true);

    expect(Object.keys(scorerMap(mastra))).toEqual(expect.arrayContaining([...LLM_SCORER_IDS]));
    for (const id of LLM_SCORER_IDS) {
      expect(scorerMap(mastra)[id].judge?.model).toMatchObject({ id: 'test-provider/judge-a' });
    }
  });

  it('replaces every LLM scorer when the configured judge model changes', async () => {
    const mastra = createMastra();
    await ensureLlmScorers(mastra);
    const first = { ...scorerMap(mastra) };

    mocks.providerConfig = { ...mocks.providerConfig!, defaultModel: 'judge-b' };
    await expect(ensureLlmScorers(mastra)).resolves.toBe(true);
    const second = scorerMap(mastra);

    for (const id of LLM_SCORER_IDS) {
      expect(second[id]).toBeDefined();
      expect(second[id]).not.toBe(first[id]);
      expect(second[id].judge?.model).toMatchObject({ id: 'test-provider/judge-b' });
    }
  });

  it('skips LLM registration when no enabled default provider is available', async () => {
    mocks.providerConfig = null;
    await expect(ensureLlmScorers(createMastra())).resolves.toBe(false);

    mocks.providerConfig = {
      providerId: 'test-provider',
      baseUrl: 'https://model.test/v1',
      apiKey: 'test-key',
      defaultModel: 'judge-a',
      isEnabled: false,
    };
    await expect(ensureLlmScorers(createMastra())).resolves.toBe(false);
  });
});
