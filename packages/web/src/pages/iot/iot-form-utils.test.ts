import { describe, expect, it, vi } from 'vitest';
import { parseJsonObjectInput, jsonObjectToText, formatIotDateTime, toFiveFieldCron, toSixFieldCron } from './iot-form-utils';

vi.mock('@douyinfe/semi-ui', () => ({
  Toast: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/abort-submit', () => ({
  abortSubmit: vi.fn(() => {
    const error = new Error('abort');
    error.name = 'AbortSubmitError';
    throw error;
  }),
}));

describe('parseJsonObjectInput', () => {
  it('maps empty text to undefined or null by option', () => {
    expect(parseJsonObjectInput({ text: ' ', label: '参数', empty: 'undefined', toast: false })).toBeUndefined();
    expect(parseJsonObjectInput({ text: '', label: '参数', empty: 'null', toast: false })).toBeNull();
  });

  it('parses object inputs', () => {
    expect(parseJsonObjectInput({ text: '{"power":"on"}', label: '参数', empty: 'undefined', toast: false })).toEqual({ power: 'on' });
  });

  it('rejects invalid JSON and arrays for warning callers', () => {
    expect(() => parseJsonObjectInput({ text: '{', label: '服务参数', empty: 'undefined', toast: 'warning' })).toThrow('invalid 服务参数');
    expect(() => parseJsonObjectInput({ text: '[]', label: '服务参数', empty: 'undefined', toast: 'warning' })).toThrow('invalid 服务参数');
  });

  it('aborts invalid and array inputs for error callers', () => {
    expect(() => parseJsonObjectInput({ text: '{', label: '参数', empty: 'null', toast: 'error', abort: true })).toThrow('abort');
    expect(() => parseJsonObjectInput({ text: '[]', label: '参数', empty: 'null', toast: 'error', abort: true })).toThrow('abort');
  });
});

describe('iot form utilities', () => {
  it('stringifies JSON objects', () => {
    expect(jsonObjectToText({ a: 1 })).toBe('{"a":1}');
    expect(jsonObjectToText({ a: 1 }, { pretty: true })).toBe('{\n  "a": 1\n}');
    expect(jsonObjectToText(null)).toBe('');
  });

  it('formats dates and converts cron field counts', () => {
    expect(formatIotDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    expect(formatIotDateTime('2026-01-02 03:04:05')).toBe('2026-01-02 03:04:05');
    expect(toSixFieldCron('0 22 * * *')).toBe('0 0 22 * * *');
    expect(toFiveFieldCron('0 0 22 * * *')).toBe('0 22 * * *');
  });
});
