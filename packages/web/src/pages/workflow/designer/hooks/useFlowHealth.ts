/**
 * useFlowHealth — 设计器实时画布体检（3A）。
 * 监听流程模型变化，debounce 后调用定义契约的 healthCheck（传 inline flowData + 当前表单字段），
 * 将返回的按 nodeKey 标记的问题聚合为 Map，驱动画布上的节点红点/告警角标。复用后端体检引擎，不重写。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncer } from '@tanstack/react-pacer';
import type { WorkflowDefinitionHealthReport, WorkflowFlowData } from '@zenith/shared/workflow';
import { fetchWorkflowFlowHealth } from '@/hooks/queries/workflow-designer';
import type { NodeHealthInfo, NodeHealthIssue } from '../types';

interface UseFlowHealthParams {
  /** 是否启用（仅在流程设计步骤启用，避免无谓请求） */
  enabled: boolean;
  /** 构建当前流程 flowData（process 变化时其 identity 变化，用于触发重算） */
  buildFlowData: () => WorkflowFlowData;
  /** 当前绑定表单字段（key + 类型），用于条件/表达式字段引用与类型兼容性校验 */
  formFields: ReadonlyArray<{ key: string; type?: string }>;
}

export function useFlowHealth({ enabled, buildFlowData, formFields }: UseFlowHealthParams): {
  report: WorkflowDefinitionHealthReport | null;
  nodeHealth: Map<string, NodeHealthInfo>;
} {
  const [report, setReport] = useState<WorkflowDefinitionHealthReport | null>(null);
  const buildRef = useRef(buildFlowData);
  buildRef.current = buildFlowData;
  const fieldsRef = useRef(formFields);
  fieldsRef.current = formFields;

  const healthDebouncer = useDebouncer(() => {
    const flowData = buildRef.current();
    if (!flowData?.nodes?.length) {
      setReport(null);
      return;
    }
    void fetchWorkflowFlowHealth(flowData, fieldsRef.current)
      .then((next) => setReport(next))
      .catch(() => { /* 体检失败静默，不打扰编辑 */ });
  }, { wait: 600 });

  useEffect(() => {
    if (!enabled) {
      setReport(null);
      healthDebouncer.cancel();
      return;
    }
    healthDebouncer.maybeExecute();
  }, [enabled, buildFlowData, formFields, healthDebouncer]);

  const nodeHealth = useMemo(() => {
    const map = new Map<string, NodeHealthInfo>();
    if (!report) return map;
    for (const check of report.checks) {
      for (const iss of check.issues) {
        if (!iss.nodeKey) continue;
        const entry = map.get(iss.nodeKey) ?? { error: 0, warn: 0, info: 0, issues: [] as NodeHealthIssue[] };
        const severity: NodeHealthIssue['severity'] = iss.severity === 'critical' ? 'critical' : iss.severity === 'warning' ? 'warning' : 'info';
        if (severity === 'critical') entry.error += 1;
        else if (severity === 'warning') entry.warn += 1;
        else entry.info += 1;
        entry.issues.push({ severity, message: iss.message, suggestion: iss.suggestion, category: check.key });
        map.set(iss.nodeKey, entry);
      }
    }
    return map;
  }, [report]);

  return { report, nodeHealth };
}
