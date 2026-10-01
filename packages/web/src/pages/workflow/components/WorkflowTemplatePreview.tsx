import { useMemo } from 'react';
import { Collapse, Descriptions, Empty, TabPane, Tabs, Typography } from '@douyinfe/semi-ui';
import { WORKFLOW_NODE_TYPE_LABELS, WORKFLOW_SIGNATURE_POLICY_OPTIONS, type WorkflowEdgeCondition, type WorkflowFormField, type WorkflowTemplate } from '@zenith/shared/workflow';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import WorkflowFormRenderer from '../designer/components/WorkflowFormRenderer';
import { flattenFields } from '../designer/components/form-renderer/field-utils';
import { APPROVAL_TYPE_OPTIONS, ASSIGNEE_TYPE_OPTIONS, APPROVE_METHOD_OPTIONS, EMPTY_ASSIGNEE_OPTIONS, OPERATOR_OPTIONS, REJECT_STRATEGY_OPTIONS, STARTER_CONDITION_FIELDS } from '../designer/constants';

const EMPTY_FIELDS: WorkflowFormField[] = [];

/** 直接预览模板携带的结构，不创建临时流程定义或表单。 */
export default function WorkflowTemplatePreview({ template }: Readonly<{ template: WorkflowTemplate }>) {
  const fields = template.formSchema?.fields ?? EMPTY_FIELDS;
  const allFields = useMemo(() => flattenFields(fields), [fields]);
  const flow = template.flowData;
  const fieldLabel = (key: string) => allFields.find((field) => field.key === key)?.label ?? key;
  const nodeLabel = (id: string) => flow?.nodes.find((node) => node.id === id)?.data.label ?? id;
  const conditionText = (rule: WorkflowEdgeCondition) => {
    const label = rule.source === 'starter'
      ? STARTER_CONDITION_FIELDS.find((field) => field.value === rule.field)?.label ?? rule.field
      : fieldLabel(rule.field);
    const operator = OPERATOR_OPTIONS.find((option) => option.value === rule.operator)?.label ?? rule.operator;
    const value = rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty' ? '' : ` ${rule.value}`;
    const aggregateLabel = rule.aggregate === 'sum' ? '合计' : rule.aggregate === 'count' ? '数量' : '平均值';
    const aggregate = rule.aggregate ? `（${aggregateLabel}${rule.aggregateField ? `：${fieldLabel(rule.aggregateField)}` : ''}）` : '';
    return `${label}${aggregate} ${operator}${value}`;
  };
  const approvalNodes = flow?.nodes.filter((node) => node.data.type === 'approve' || node.data.type === 'handler' || node.data.type === 'ccNode') ?? [];
  const branchEdges = flow?.edges.filter((edge) => edge.isDefault || edge.condition || edge.conditions?.length || edge.isException) ?? [];
  const settings = template.formSchema?.settings;

  return (
    <Tabs collapsible="auto" type="line">
      <TabPane itemKey="form" tab="表单结构">
        {/* FormRenderer 的 Row gutter=16 会产生左右 -8px 外边距，滚动容器需留出完整的半个 gutter。 */}
        <div style={{ maxHeight: '55vh', overflow: 'auto', padding: '16px 8px' }}>
          {fields.length > 0 ? (
            <WorkflowFormRenderer
              fields={fields}
              readOnly
              labelPosition={settings?.labelPosition}
              labelAlign={settings?.labelAlign}
              labelWidth={settings?.labelWidth}
            />
          ) : <Empty description="此模板未配置表单字段" />}
        </div>
      </TabPane>
      <TabPane itemKey="flow" tab="审批流程">
        <div style={{ paddingTop: 16 }}>
          <WorkflowGraphView flowData={flow} formFields={allFields} height="55vh" />
        </div>
      </TabPane>
      <TabPane itemKey="rules" tab="审批规则">
        <div style={{ maxHeight: '55vh', overflow: 'auto', paddingTop: 16 }}>
          {approvalNodes.length === 0 && branchEdges.length === 0 ? <Empty description="此模板未配置审批规则" /> : (
            <Collapse>
              {approvalNodes.map(({ id, data }) => (
                <Collapse.Panel key={`node:${id}`} itemKey={`node:${id}`} header={`${data.label} · ${WORKFLOW_NODE_TYPE_LABELS[data.type]}`}>
                  <Descriptions
                    size="small"
                    data={[
                      { key: '人员来源', value: ASSIGNEE_TYPE_OPTIONS.find((option) => option.value === data.assigneeType)?.label ?? '未配置' },
                      ...(data.assigneeNames?.length ? [{ key: '指定人员', value: data.assigneeNames.join('、') }] : []),
                      ...(data.assigneeName ? [{ key: '指定人员', value: data.assigneeName }] : []),
                      ...(data.type === 'approve' ? [
                        { key: '审批类型', value: APPROVAL_TYPE_OPTIONS.find((option) => option.value === (data.approvalType ?? 'manual'))?.label },
                        { key: '审批方式', value: APPROVE_METHOD_OPTIONS.find((option) => option.value === (data.approveMethod ?? 'or'))?.label },
                        { key: '签名要求', value: WORKFLOW_SIGNATURE_POLICY_OPTIONS.find((option) => option.value === (data.signaturePolicy ?? 'none'))?.label },
                        ...(data.operations?.includes('opinionRequired') ? [{ key: '审批意见', value: '必填' }] : []),
                      ] : []),
                      ...(data.type !== 'ccNode' ? [
                        { key: '驳回处理', value: REJECT_STRATEGY_OPTIONS.find((option) => option.value === (data.rejectStrategy ?? 'terminate'))?.label },
                        { key: '无审批人时', value: EMPTY_ASSIGNEE_OPTIONS.find((option) => option.value === data.emptyStrategy)?.label ?? '未配置' },
                      ] : []),
                    ]}
                  />
                </Collapse.Panel>
              ))}
              {branchEdges.map((edge) => (
                <Collapse.Panel key={`edge:${edge.id}`} itemKey={`edge:${edge.id}`} header={edge.label || `${nodeLabel(edge.source)} → ${nodeLabel(edge.target)}`}>
                  {edge.isDefault ? <Typography.Text>未命中其它分支时进入此分支</Typography.Text> : edge.isException ? <Typography.Text>来源节点执行异常时进入此分支</Typography.Text> : (
                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                      {edge.conditions?.length
                        ? edge.conditions.map((group) => `(${group.rules.map(conditionText).join(group.type === 'and' ? ' 且 ' : ' 或 ')})`).join(' 或\n')
                        : edge.condition ? conditionText(edge.condition) : '未配置条件'}
                    </Typography.Paragraph>
                  )}
                </Collapse.Panel>
              ))}
            </Collapse>
          )}
        </div>
      </TabPane>
    </Tabs>
  );
}
