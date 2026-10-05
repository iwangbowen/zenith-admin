import { describe, expect, it, vi } from 'vitest';
import { resolveWorkflowSubscriptionSecret } from './subscription-secret';

describe('subscription key editing', () => {
  it('generates a missing HMAC key and does not generate for unsigned mode', () => {
    const generate = vi.fn(() => 'generated-key');
    expect(resolveWorkflowSubscriptionSecret('hmacSha256', '', null, generate)).toBe('generated-key');
    expect(resolveWorkflowSubscriptionSecret('none', '', null, generate)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, '', '   '])('keeps the previous usable key for a blank editor field %s', supplied => {
    const generate = vi.fn(() => 'new-key');
    expect(resolveWorkflowSubscriptionSecret('hmacSha256', supplied, ' saved key ', generate)).toBe(' saved key ');
    expect(generate).not.toHaveBeenCalled();
  });
  it('preserves an explicit replacement verbatim and reuses a key when switching signing modes', () => {
    const generate = vi.fn(() => 'new-key');
    expect(resolveWorkflowSubscriptionSecret('none', ' replacement ', 'old-key', generate)).toBe(' replacement ');
    expect(resolveWorkflowSubscriptionSecret('hmacSha256', undefined, 'replacement', generate)).toBe('replacement');
    expect(resolveWorkflowSubscriptionSecret('hmacSha256', undefined, null, generate)).toBe('new-key');
  });
});
