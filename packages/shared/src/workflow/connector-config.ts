import type { WorkflowConnectorType, WorkflowConnectorHttpConfig } from './types';

/** Fields edited by the connector form; only the selected channel is persisted. */
export interface WorkflowConnectorConfigFields {
  baseUrl: string;
  method: NonNullable<WorkflowConnectorHttpConfig['method']>;
  authType: NonNullable<WorkflowConnectorHttpConfig['authType']>;
  apiKeyHeader: string;
  contentType: NonNullable<WorkflowConnectorHttpConfig['contentType']>;
  emailTo: string;
  emailSubject: string;
  smsPhone: string;
  smsTemplateCode: string;
  mockScenario: string;
}

export function isWorkflowHttpConnector(type: WorkflowConnectorType): boolean {
  return ['http', 'webhook', 'wecom', 'dingtalk', 'feishu'].includes(type);
}

export function workflowConnectorConfigFields(config: Record<string, unknown>): WorkflowConnectorConfigFields {
  const cfg = config as Partial<WorkflowConnectorHttpConfig>;
  const text = (key: string) => typeof config[key] === 'string' ? config[key] : '';
  return {
    baseUrl: cfg.baseUrl ?? '',
    method: cfg.method ?? 'GET',
    authType: cfg.authType ?? 'none',
    apiKeyHeader: cfg.apiKeyHeader ?? '',
    contentType: cfg.contentType ?? 'json',
    emailTo: text('to'),
    emailSubject: text('subject'),
    smsPhone: text('phone'),
    smsTemplateCode: text('templateCode'),
    mockScenario: text('scenario'),
  };
}

export function workflowConnectorConfigFromFields(
  type: WorkflowConnectorType,
  fields: WorkflowConnectorConfigFields,
  headers?: Record<string, string>,
  query?: Record<string, string>,
): Record<string, unknown> {
  if (type === 'email') return { to: fields.emailTo.trim(), subject: fields.emailSubject.trim() };
  if (type === 'sms') return { phone: fields.smsPhone.trim(), templateCode: fields.smsTemplateCode.trim() };
  if (type === 'mock') return { scenario: fields.mockScenario.trim() };
  return {
    baseUrl: fields.baseUrl.trim(),
    method: fields.method,
    authType: fields.authType,
    contentType: fields.contentType,
    ...(fields.authType === 'apiKey' && fields.apiKeyHeader.trim() ? { apiKeyHeader: fields.apiKeyHeader.trim() } : {}),
    ...(headers ? { headers } : {}),
    ...(query ? { query } : {}),
  };
}
