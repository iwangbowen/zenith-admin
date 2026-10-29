import { describe, expect, it } from 'vitest';
import { assertOutsideEventConsumer, runInEventConsumer } from './context';

describe('event consumer I/O boundary', () => {
  it('blocks outbound I/O until the consumer transaction has finished', async () => {
    await expect(runInEventConsumer('settlement', async () => {
      await Promise.resolve(); assertOutsideEventConsumer();
    })).rejects.toThrow('forbidden');
    expect(() => assertOutsideEventConsumer()).not.toThrow();
  });
});
