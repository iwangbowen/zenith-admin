/**
 * 流程诊断聚合服务（4A · correlationId 诊断包）。
 *
 * 单实例诊断包（exportInstanceDiagnosticBundle）+ 作业链路（getWorkflowJobChain）已存在；
 * 本服务把二者按 correlationId 聚合：一次操作的全部异步 fan-out（含跨实例 / 子流程串联）的作业链路，
 * 加上该链路涉及的每个实例的诊断包（诊断 + 轨迹 + 执行 Token），打包供工单留档 / 离线分析。
 */
import { getWorkflowJobChain } from './workflow-jobs.service';
import { exportInstanceDiagnosticBundle } from './workflow-instances.service';
import { formatDateTime } from '../../lib/datetime';

export async function exportTraceDiagnosticBundle(correlationId: string) {
  const chain = await getWorkflowJobChain(correlationId);
  // 链路涉及的实例逐个取诊断包；单个实例失败（已删除/越权）不影响整体，跳过即可
  const bundles = await Promise.all(
    chain.stats.instanceIds.map((id) => exportInstanceDiagnosticBundle(id).catch(() => null)),
  );
  return {
    correlationId,
    generatedAt: formatDateTime(new Date()),
    chain,
    instances: bundles.filter((b): b is NonNullable<typeof b> => b != null),
  };
}
