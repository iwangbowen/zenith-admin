import { useState } from 'react';
import { Select, Input, InputNumber, Switch, Typography, RadioGroup, Radio, TextArea } from '@douyinfe/semi-ui';
import type { WorkflowNodeFailurePolicy, WorkflowCompensationAction, WorkflowCompensationActionType, WorkflowNodeFailureAction } from '@zenith/shared';
import { WORKFLOW_NODE_FAILURE_ACTION_OPTIONS as ACTION_OPTIONS } from '../constants';
const COMP_TYPE_OPTIONS: Array<{ value: WorkflowCompensationActionType; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'http', label: 'HTTP 直连' },
  { value: 'connector', label: '流程连接器' },
  { value: 'sms', label: '短信' },
  { value: 'email', label: '邮件' },
  { value: 'updateData', label: '回填/回滚表单字段' },
];
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE'].map((v) => ({ value: v, label: v }));

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 };
const labelStyle: React.CSSProperties = { width: 88, flexShrink: 0, paddingTop: 6, textAlign: 'right', color: 'var(--semi-color-text-2)', fontSize: 13 };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={rowStyle}><span style={labelStyle}>{label}</span><div style={{ flex: 1, minWidth: 0 }}>{children}</div></div>;
}

const splitList = (s: string) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
const jsonStr = (o: unknown) => (o && typeof o === 'object' ? JSON.stringify(o, null, 2) : '');

interface CompProps {
  value: WorkflowCompensationAction | undefined;
  onChange: (v: WorkflowCompensationAction) => void;
  connectorOptions: Array<{ value: number; label: string }>;
}

function CompensationActionEditor({ value, onChange, connectorOptions }: CompProps) {
  const v: WorkflowCompensationAction = value ?? { type: 'none' };
  const set = (patch: Partial<WorkflowCompensationAction>) => onChange({ ...v, ...patch });
  const [valuesText, setValuesText] = useState(jsonStr(v.fieldValues));
  const commitValues = () => {
    const t = valuesText.trim();
    if (!t) { set({ fieldValues: undefined }); return; }
    try { set({ fieldValues: JSON.parse(t) as Record<string, string> }); } catch { /* 保留文本，等待修正 */ }
  };
  return (
    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12, marginBottom: 10 }}>
      <Row label="动作类型">
        <Select value={v.type} optionList={COMP_TYPE_OPTIONS} onChange={(t) => set({ type: t as WorkflowCompensationActionType })} style={{ width: '100%' }} />
      </Row>
      {(v.type === 'http' || v.type === 'connector') && (
        <>
          {v.type === 'connector' && (
            <Row label="连接器"><Select value={v.connectorId} optionList={connectorOptions} onChange={(c) => set({ connectorId: c as number })} style={{ width: '100%' }} placeholder="选择连接器" showClear /></Row>
          )}
          <Row label={v.type === 'connector' ? '相对路径' : 'URL'}><Input value={v.url ?? ''} onChange={(u) => set({ url: u })} placeholder="支持 {{form.x}} {{instanceId}}" /></Row>
          <Row label="方法"><Select value={v.httpMethod ?? 'POST'} optionList={METHOD_OPTIONS} onChange={(m) => set({ httpMethod: m as 'GET' | 'POST' | 'PUT' | 'DELETE' })} style={{ width: '100%' }} /></Row>
          <Row label="请求体模板"><TextArea value={v.bodyTemplate ?? ''} onChange={(b) => set({ bodyTemplate: b })} autosize={{ minRows: 2, maxRows: 6 }} placeholder={'{\n  "orderId": "{{form.orderId}}"\n}'} /></Row>
        </>
      )}
      {(v.type === 'sms' || v.type === 'email') && (
        <>
          <Row label="收件人"><Input value={(v.recipients ?? []).join(',')} onChange={(r) => set({ recipients: splitList(r) })} placeholder="逗号分隔，支持 {{form.phone}}" /></Row>
          {v.type === 'sms' && <Row label="短信模板ID"><InputNumber value={v.templateId} onChange={(t) => set({ templateId: typeof t === 'number' ? t : undefined })} style={{ width: '100%' }} /></Row>}
          {v.type === 'sms' && <Row label="模板变量"><TextArea value={valuesText} onChange={setValuesText} onBlur={commitValues} autosize={{ minRows: 2, maxRows: 5 }} placeholder={'{\n  "code": "{{form.code}}"\n}'} /></Row>}
          {v.type === 'email' && <Row label="正文模板"><TextArea value={v.bodyTemplate ?? ''} onChange={(b) => set({ bodyTemplate: b })} autosize={{ minRows: 2, maxRows: 6 }} /></Row>}
        </>
      )}
      {v.type === 'updateData' && (
        <>
          <Row label="字段 Keys"><Input value={(v.fieldKeys ?? []).join(',')} onChange={(k) => set({ fieldKeys: splitList(k) })} placeholder="逗号分隔，如 inventoryLocked" /></Row>
          <Row label="字段值"><TextArea value={valuesText} onChange={setValuesText} onBlur={commitValues} autosize={{ minRows: 2, maxRows: 5 }} placeholder={'{\n  "inventoryLocked": "false"\n}'} /></Row>
        </>
      )}
      {v.type !== 'none' && (
        <Row label="最大重试"><InputNumber min={0} max={10} value={v.maxRetries ?? 3} onChange={(n) => set({ maxRetries: typeof n === 'number' ? n : undefined })} style={{ width: '100%' }} /></Row>
      )}
    </div>
  );
}

interface Props {
  value: WorkflowNodeFailurePolicy | undefined;
  onChange: (v: WorkflowNodeFailurePolicy | undefined) => void;
  nodeOptions: Array<{ value: string; label: string }>;
  connectorOptions: Array<{ value: number; label: string }>;
}

/** 节点级统一失败策略编辑器（Saga / 补偿）。存储于 node.props.failurePolicy，随流程树 round-trip。 */
export default function FailurePolicySection({ value, onChange, nodeOptions, connectorOptions }: Props) {
  const enabled = !!value;
  const v: WorkflowNodeFailurePolicy = value ?? { action: 'notify' };
  const set = (patch: Partial<WorkflowNodeFailurePolicy>) => onChange({ ...v, ...patch });
  const fallbackMode = v.fallbackNodeKey != null ? 'node' : 'action';
  return (
    <div className="fd-drawer-tab-content">
      <Typography.Title heading={6} style={{ marginBottom: 12 }}>失败策略（Saga / 补偿）</Typography.Title>
      <Row label="启用">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={enabled} onChange={(c) => onChange(c ? { action: 'notify' } : undefined)} />
          <Typography.Text type="tertiary" size="small">关闭则沿用异常边 / catchNode 传统兜底</Typography.Text>
        </div>
      </Row>
      {enabled && (
        <>
          <Row label="失败动作"><Select value={v.action} optionList={ACTION_OPTIONS} onChange={(a) => set({ action: a as WorkflowNodeFailureAction })} style={{ width: '100%' }} /></Row>
          {v.action === 'retry' && (
            <Row label="最大重试"><InputNumber min={0} max={10} value={v.maxRetries ?? 3} onChange={(n) => set({ maxRetries: typeof n === 'number' ? n : undefined })} style={{ width: '100%' }} /></Row>
          )}
          {v.action === 'fallback' && (
            <>
              <Row label="兜底方式">
                <RadioGroup
                  value={fallbackMode}
                  onChange={(e) => e.target.value === 'node'
                    ? set({ fallbackNodeKey: v.fallbackNodeKey ?? '', fallbackAction: undefined })
                    : set({ fallbackNodeKey: undefined, fallbackAction: v.fallbackAction ?? { type: 'none' } })}
                >
                  <Radio value="node">跳转备用节点</Radio>
                  <Radio value="action">执行备选动作</Radio>
                </RadioGroup>
              </Row>
              {fallbackMode === 'node'
                ? <Row label="备用节点"><Select value={v.fallbackNodeKey || undefined} optionList={nodeOptions} onChange={(k) => set({ fallbackNodeKey: k as string })} style={{ width: '100%' }} placeholder="选择节点" /></Row>
                : <CompensationActionEditor value={v.fallbackAction} onChange={(a) => set({ fallbackAction: a })} connectorOptions={connectorOptions} />}
            </>
          )}
          {v.action === 'compensate' && (
            <>
              <CompensationActionEditor value={v.compensation} onChange={(a) => set({ compensation: a })} connectorOptions={connectorOptions} />
              <Row label="反序回滚">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch checked={!!v.sagaRollback} onChange={(c) => set({ sagaRollback: c })} />
                  <Typography.Text type="tertiary" size="small">失败时对此前已成功副作用倒序补偿</Typography.Text>
                </div>
              </Row>
            </>
          )}
        </>
      )}
    </div>
  );
}
