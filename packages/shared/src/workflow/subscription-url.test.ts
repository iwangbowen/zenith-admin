import { describe, expect, it } from 'vitest';
import { isWorkflowSubscriptionConnector, isWorkflowSubscriptionUrl } from './subscription-url';

describe('event subscription callback addresses', () => {
  it('only accepts connectors which preserve the complete event JSON', () => {
    expect(['http', 'webhook'].every(isWorkflowSubscriptionConnector)).toBe(true);
    expect(['email', 'sms', 'wecom', 'dingtalk', 'feishu', 'mq', 'database'].some(isWorkflowSubscriptionConnector)).toBe(false);
  });
  it('requires an absolute HTTP URL when no connector supplies the origin', () => {
    expect(isWorkflowSubscriptionUrl('https://erp.example.com/events')).toBe(true);
    expect(isWorkflowSubscriptionUrl('/events')).toBe(false);
    expect(isWorkflowSubscriptionUrl('/events', null)).toBe(false);
  });

  it.each(['/erp/contracts', 'erp/contracts', './events?source=workflow'])('accepts connector path %s', path => {
    expect(isWorkflowSubscriptionUrl(path, 2)).toBe(true);
  });

  it.each(['//outside.example.com/events', '\\\\outside.example.com\\events', 'javascript:alert(1)', 'file:///etc/passwd', 'http:malformed', '', ' /events', '#fragment'])('rejects a relative address which could select another origin: %s', path => {
      expect(isWorkflowSubscriptionUrl(path, 2)).toBe(false);
    });
});
