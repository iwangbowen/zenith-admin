import { describe, expect, it } from 'vitest';
import { cronSecondsIgnored, toMinuteCron } from './cron-expression';

describe('toMinuteCron', () => {
  it('drops the seconds field of a 6-field expression', () => {
    expect(toMinuteCron('30 * * * * *')).toBe('* * * * *');
    expect(toMinuteCron('0 */5 * * * *')).toBe('*/5 * * * *');
    expect(toMinuteCron('0 0 2 * * 1-5')).toBe('0 2 * * 1-5');
  });

  it('keeps a 5-field expression unchanged and normalizes whitespace', () => {
    expect(toMinuteCron('*/5 * * * *')).toBe('*/5 * * * *');
    expect(toMinuteCron('  0   3 * * *  ')).toBe('0 3 * * *');
  });

  it('passes other shapes through for the validator to reject', () => {
    expect(toMinuteCron('* *')).toBe('* *');
  });
});

describe('cronSecondsIgnored', () => {
  it('flags 6-field expressions whose seconds field is not 0', () => {
    expect(cronSecondsIgnored('30 * * * * *')).toBe(true);
    expect(cronSecondsIgnored('*/15 * * * * *')).toBe(true);
    expect(cronSecondsIgnored('0 */5 * * * *')).toBe(false);
  });

  it('never flags 5-field expressions', () => {
    expect(cronSecondsIgnored('*/5 * * * *')).toBe(false);
    expect(cronSecondsIgnored('30 * * * *')).toBe(false);
  });
});
