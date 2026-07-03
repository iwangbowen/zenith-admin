import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Collapse, Empty, Progress, SideSheet, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { WorkflowDefinitionHealthIssue, WorkflowDefinitionHealthReport, WorkflowFlowData } from '@zenith/shared';
import { useWorkflowDesignerHealthCheck } from '@/hooks/queries/workflow-designer';

interface Props {
  visible: boolean;
  flowData: WorkflowFlowData;
  definitionId: number | null;
  /** 设计器当前绑定表单字段（key + 类型），用于字段引用/类型兼容性校验 */
  formFields?: ReadonlyArray<{ key: string; type?: string }>;
  onClose: () => void;
}

type TagColor = 'green' | 'blue' | 'orange' | 'red' | 'grey';

const GRADE_COLOR: Record<string, string> = { A: 'var(--semi-color-success)', B: 'var(--semi-color-primary)', C: 'var(--semi-color-warning)', D: 'var(--semi-color-danger)' };
const GRADE_TEXT: Record<string, string> = { A: '优秀', B: '良好', C: '一般', D: '不达标' };
const STATUS_META: Record<string, { text: string; color: TagColor }> = {
  pass: { text: '通过', color: 'green' },
  warn: { text: '关注', color: 'orange' },
  fail: { text: '不达标', color: 'red' },
};
const SEVERITY_META: Record<string, { text: string; color: TagColor }> = {
  critical: { text: '严重', color: 'red' },
  warning: { text: '警告', color: 'orange' },
  info: { text: '提示', color: 'blue' },
};

function renderIssue(issue: WorkflowDefinitionHealthIssue, idx: number) {
  const sm = SEVERITY_META[issue.severity] ?? SEVERITY_META.info;
  return (
    <div key={idx} style={{ padding: '6px 0', borderBottom: '1px dashed var(--semi-color-border)' }}>
      <Space align="start" spacing={8}>
        <Tag size="small" color={sm.color}>{sm.text}</Tag>
        <div style={{ flex: 1 }}>
          <Typography.Text size="small">{issue.message}</Typography.Text>
          {issue.nodeName && <Typography.Text size="small" type="tertiary"> （节点：{issue.nodeName}）</Typography.Text>}
          {issue.suggestion && <Typography.Paragraph size="small" type="tertiary" style={{ margin: '2px 0 0' }}>建议：{issue.suggestion}</Typography.Paragraph>}
        </div>
      </Space>
    </div>
  );
}

export default function WorkflowHealthCheckDrawer({ visible, flowData, definitionId, formFields, onClose }: Props) {
  const [report, setReport] = useState<WorkflowDefinitionHealthReport | null>(null);
  const healthCheckMutation = useWorkflowDesignerHealthCheck();
  const loading = healthCheckMutation.isPending;

  const runCheck = useCallback(async () => {
    try {
      const next = await healthCheckMutation.mutateAsync({ flowData, definitionId, formFields });
      setReport(next);
    } catch {
      // request 层负责错误提示
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  useEffect(() => {
    if (visible) void runCheck();
    else setReport(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <SideSheet title="发布前体检" visible={visible} onCancel={onClose} width="min(560px, 96vw)">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" theme="borderless" icon={<RefreshCw size={14} className={loading ? 'spin' : ''} />} disabled={loading} onClick={() => void runCheck()}>重新检查</Button>
      </div>

      {loading && !report && <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}
      {!loading && !report && <Empty description="暂无体检结果" />}

      {report && (
        <Space vertical align="start" style={{ width: '100%' }} spacing={16}>
          {/* 总分 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, width: '100%' }}>
            <Progress percent={report.score} type="circle" width={92} strokeWidth={8} stroke={GRADE_COLOR[report.grade]} format={() => (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: GRADE_COLOR[report.grade] }}>{report.score}</div>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>评级 {report.grade}</div>
              </div>
            )} />
            <div>
              <Typography.Title heading={5} style={{ margin: 0, color: GRADE_COLOR[report.grade] }}>{GRADE_TEXT[report.grade]}</Typography.Title>
              <Typography.Text type="tertiary" size="small">
                结构{report.valid ? '合法' : '不合法'} · 生成于 {report.generatedAt}
              </Typography.Text>
            </div>
          </div>

          {!report.valid && (
            <Banner fullMode={false} type="danger" closeIcon={null} description="流程结构存在硬性问题，发布前请先修复结构合法性。" style={{ width: '100%' }} />
          )}

          {/* 分维度检查 */}
          <div style={{ width: '100%' }}>
            <Typography.Title heading={6} style={{ marginBottom: 8 }}>分维度检查</Typography.Title>
            <Collapse accordion={false} defaultActiveKey={report.checks.filter((c) => c.status !== 'pass').map((c) => c.key)}>
              {report.checks.map((c) => {
                const sm = STATUS_META[c.status] ?? STATUS_META.pass;
                return (
                  <Collapse.Panel
                    key={c.key}
                    itemKey={c.key}
                    header={(
                      <Space spacing={8}>
                        <Tag size="small" color={sm.color}>{sm.text}</Tag>
                        <Typography.Text strong>{c.title}</Typography.Text>
                        <Typography.Text type="tertiary" size="small">{c.score} 分 · 权重 {Math.round(c.weight * 100)}%</Typography.Text>
                      </Space>
                    )}
                  >
                    <Typography.Text size="small" type="tertiary">{c.summary}</Typography.Text>
                    {c.issues.length > 0
                      ? <div style={{ marginTop: 6 }}>{c.issues.map(renderIssue)}</div>
                      : <Typography.Paragraph size="small" type="success" style={{ margin: '6px 0 0' }}>✓ 未发现问题</Typography.Paragraph>}
                  </Collapse.Panel>
                );
              })}
            </Collapse>
          </div>

          {/* 分支覆盖 */}
          {report.branchCoverage.length > 0 && (
            <div style={{ width: '100%' }}>
              <Typography.Title heading={6} style={{ marginBottom: 8 }}>分支覆盖分析（{report.branchCoverage.length} 个网关）</Typography.Title>
              <Space vertical align="start" style={{ width: '100%' }} spacing={8}>
                {report.branchCoverage.map((g) => (
                  <div key={g.nodeKey} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
                    <Space spacing={8} style={{ flexWrap: 'wrap' }}>
                      <Typography.Text strong size="small">{g.nodeName}</Typography.Text>
                      <Tag size="small" color="grey">{g.branchCount} 分支</Tag>
                      <Tag size="small" color={g.hasDefault ? 'green' : 'orange'}>{g.hasDefault ? '有默认分支' : '无默认分支'}</Tag>
                    </Space>
                    {g.issues.length > 0
                      ? <div style={{ marginTop: 4 }}>{g.issues.map(renderIssue)}</div>
                      : <Typography.Text size="small" type="success" style={{ display: 'block', marginTop: 4 }}>✓ 覆盖完整</Typography.Text>}
                  </div>
                ))}
              </Space>
            </div>
          )}
        </Space>
      )}
    </SideSheet>
  );
}
