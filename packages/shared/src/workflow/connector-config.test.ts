import { describe, expect, it } from 'vitest';
import { workflowConnectorConfigFields, workflowConnectorConfigFromFields } from './connector-config';

describe('connector channel configuration round trips', () => {
  it('retains email recipients and subject when an existing connector is edited', () => {
    const config = { to: 'finance@example.com,manager@example.com', subject: '报销付款审批' };
    const fields = workflowConnectorConfigFields(config);
    expect(workflowConnectorConfigFromFields('email', fields)).toEqual(config);
  });

  it('retains the SMS destination and registered template code when edited', () => {
    const config = { phone: '13800000000', templateCode: 'purchase-approved' };
    expect(workflowConnectorConfigFromFields('sms', workflowConnectorConfigFields(config))).toEqual(config);
  });

  it('saves only the selected channel after switching from HTTP to email', () => {
    const fields = workflowConnectorConfigFields({ baseUrl: 'https://example.com', authType: 'bearer' });
    fields.emailTo = ' finance@example.com ';
    fields.emailSubject = ' 采购完成 ';
    expect(workflowConnectorConfigFromFields('email', fields, { Authorization: 'unused' })).toEqual({
      to: 'finance@example.com', subject: '采购完成',
    });
  });

  it('retains HTTP request configuration and leaves the source object unchanged', () => {
    const config = {
      baseUrl: 'https://erp.example.com/api', method: 'POST', authType: 'apiKey',
      apiKeyHeader: 'X-ERP-Key', contentType: 'form',
    };
    const before = structuredClone(config);
    expect(workflowConnectorConfigFromFields('http', workflowConnectorConfigFields(config), { 'X-Env': 'test' }, { version: 'v1' }))
      .toEqual({ ...config, headers: { 'X-Env': 'test' }, query: { version: 'v1' } });
    expect(config).toEqual(before);
  });
});
