import { lazy, Suspense, useMemo } from 'react';
import { Spin } from '@douyinfe/semi-ui';
import type { WorkflowFlowData, WorkflowTask } from '@zenith/shared/workflow';
import { buildNodeRuntimeMap } from './workflow-runtime';
const GraphCanvas = lazy(() => import('./WorkflowGraphCanvas'));
interface Props {
 flowData: WorkflowFlowData | null | undefined;
 tasks?: WorkflowTask[];
 height?: number | string;
 instanceStatus?: string;
 formFields?: ReadonlyArray<{ key: string; label: string; type?: string }>;
}
export default function WorkflowGraphView({ flowData, tasks, height = 480, instanceStatus }: Readonly<Props>) {
 const runtime = useMemo(() => buildNodeRuntimeMap(tasks ?? []), [tasks]);
 return <Suspense fallback={<Spin style={{ height }} />}><GraphCanvas flowData={flowData ?? { nodes: [], edges: [] }} nodeRuntime={runtime} height={height} instanceStatus={instanceStatus} /></Suspense>;
}
