/**
 * 布局容器字段：栅格行 / 分组 / 标签页 / 分步。
 * 子字段经 `renderField` 回调渲染（由 FieldRenderer 注入），容器本身不反向依赖 FieldRenderer，避免循环引用。
 * 所有子字段都被显隐规则隐藏时不渲染空白容器。
 */
import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Col, Collapse, Row, Steps, Tabs } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { isWorkflowFieldVisible as isFieldVisible } from '@zenith/shared/workflow';
import { ValuesContext } from './contexts';
import { colSpanOf, getColumnKey } from './field-utils';

export type RenderField = (field: WorkflowFormField) => ReactNode;

interface LayoutFieldProps {
  field: WorkflowFormField;
  renderField: RenderField;
}

function renderPaneFields(pane: { fields: WorkflowFormField[] }, renderField: RenderField, values: Record<string, unknown>): ReactNode {
  return (
    <Row gutter={16}>
      {pane.fields.map((cf) => (
        isFieldVisible(cf, values) ? (
          <Col span={colSpanOf(cf)} key={cf.key}>{renderField(cf)}</Col>
        ) : null
      ))}
    </Row>
  );
}

export function RowLayout({ field, renderField }: Readonly<LayoutFieldProps>) {
  const values = useContext(ValuesContext);
  const columns = field.columns || [];
  const hasVisibleChild = columns.some((col) => (col.fields || []).some((cf) => isFieldVisible(cf, values)));
  if (!hasVisibleChild) return null;
  return (
    <Row gutter={16}>
      {columns.map((col) => (
        <Col span={col.span} key={getColumnKey(field.key, col)}>
          {(col.fields || []).map(childField => (
            isFieldVisible(childField, values) ? renderField(childField) : null
          ))}
        </Col>
      ))}
    </Row>
  );
}

export function GroupLayout({ field, renderField }: Readonly<LayoutFieldProps>) {
  const values = useContext(ValuesContext);
  const visibleChildren = (field.children || []).filter((cf) => isFieldVisible(cf, values));
  if (visibleChildren.length === 0) return null;
  const groupBody = (
    <Row gutter={16}>
      {visibleChildren.map(childField => (
        <Col span={colSpanOf(childField)} key={childField.key}>
          {renderField(childField)}
        </Col>
      ))}
    </Row>
  );
  if (field.collapsible) {
    return (
      <div style={{ marginBottom: 24 }}>
        <Collapse defaultActiveKey={field.defaultCollapsed ? [] : ['group']} expandIconPosition="left">
          <Collapse.Panel header={field.title || field.label} itemKey="group">
            <div style={{ paddingTop: 8 }}>{groupBody}</div>
          </Collapse.Panel>
        </Collapse>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 15, fontWeight: 600,
        color: 'var(--semi-color-text-0)',
        borderBottom: '1px solid var(--semi-color-border)',
        paddingBottom: 8, marginBottom: 16,
      }}>
        {field.title || field.label}
      </div>
      {groupBody}
    </div>
  );
}

export function TabsLayout({ field, renderField }: Readonly<LayoutFieldProps>) {
  const values = useContext(ValuesContext);
  const panes = field.panes ?? [];
  if (panes.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <Tabs collapsible="auto" type="line" keepDOM lazyRender={false}>
        {panes.map((pane, i) => (
          <Tabs.TabPane tab={pane.title || `标签${i + 1}`} itemKey={String(i)} key={`${field.key}-tab-${i}`}>
            <div style={{ paddingTop: 8 }}>{renderPaneFields(pane, renderField, values)}</div>
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  );
}

export function StepsLayout({ field, renderField }: Readonly<LayoutFieldProps>) {
  const values = useContext(ValuesContext);
  const panes = field.panes ?? [];
  const [current, setCurrent] = useState(0);
  if (panes.length === 0) return null;
  const cur = Math.min(current, panes.length - 1);
  return (
    <div style={{ marginBottom: 24 }}>
      <Steps type="basic" size="small" current={cur} onChange={setCurrent} style={{ marginBottom: 16 }}>
        {panes.map((p, i) => <Steps.Step key={`${field.key}-step-${i}`} title={p.title || `步骤${i + 1}`} />)}
      </Steps>
      {panes.map((pane, i) => (
        <div key={`${field.key}-pane-${i}`} style={{ display: i === cur ? 'block' : 'none' }}>
          {renderPaneFields(pane, renderField, values)}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <Button disabled={cur === 0} onClick={() => setCurrent(cur - 1)}>上一步</Button>
        <Button disabled={cur === panes.length - 1} onClick={() => setCurrent(cur + 1)}>下一步</Button>
      </div>
    </div>
  );
}
