import { isHttpUrl } from '../core/url';

/** Event deliveries require a connector that preserves the JSON event body. */
export function isWorkflowSubscriptionConnector(type: string): type is 'http' | 'webhook' {
  return type === 'http' || type === 'webhook';
}

/** A connector-relative callback may change its path, never its origin. */
export function isWorkflowSubscriptionRelativePath(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && !/[\\\s]/.test(value)
    && !value.startsWith('//')
    && !/^[a-z][a-z\d+.-]*:/i.test(value)
    && !value.startsWith('#');
}

export function isWorkflowSubscriptionUrl(value: string, connectorId?: number | null): boolean {
  return (/^https?:\/\//i.test(value) && isHttpUrl(value))
    || (!!connectorId && isWorkflowSubscriptionRelativePath(value));
}
