import { HTTPException } from 'hono/http-exception';
import type { SignatureInput, SignatureSnapshot } from '@zenith/shared/core';
import { clearWorkflowFormSignaturesData, mapWorkflowFormSignatures, WorkflowFormSignatureError, type WorkflowInstanceFormSnapshot, type WorkflowNodeConfig } from '@zenith/shared/workflow';
import { workflowIdentity } from '../../../lib/workflow-identity';

type Values = Record<string, unknown>;
type SignatureActor = { userId: number; tenantId: number | null };

/** 签名 I/O 在工作流事务前完成；递归映射与同路径保留规则由 shared 唯一实现。 */
export async function resolveWorkflowFormSignatures(snapshot: WorkflowInstanceFormSnapshot | null | undefined, values: Values, previous: Values = {}, actor?: SignatureActor): Promise<Values> {
  if (snapshot?.formType !== 'designer') return values;
  try {
    return await mapWorkflowFormSignatures(snapshot.fields, values, previous, (input, policy) => workflowIdentity().resolveSignature(input, policy, actor));
  } catch (error) {
    if (error instanceof WorkflowFormSignatureError) throw new HTTPException(400, { message: error.message });
    throw error;
  }
}

export function clearWorkflowFormSignatures(snapshot: WorkflowInstanceFormSnapshot | null | undefined, values: Values): Values {
  return snapshot?.formType === 'designer' ? clearWorkflowFormSignaturesData(snapshot.fields, values) : values;
}

/** 批量入口的模式只由服务端传入，不能由请求体降低签署要求。 */
export async function resolveWorkflowTaskSignature(node: WorkflowNodeConfig | undefined, input: SignatureInput | undefined, batch: boolean): Promise<SignatureSnapshot | undefined> {
  const policy = node?.signaturePolicy ?? 'none';
  if (batch && policy === 'handwritten') throw new HTTPException(400, { message: '该节点要求每次手写，请单独审批' });
  if (batch && input && input.source !== 'saved') throw new HTTPException(400, { message: '批量审批仅可使用已确认的个人签名' });
  if (policy === 'none') return undefined;
  if (!input) throw new HTTPException(400, { message: policy === 'handwritten' ? '请完成本次手写签名' : '请确认本次审批使用的签名' });
  return workflowIdentity().resolveSignature(input, policy);
}

export function signatureTaskValues(snapshot: SignatureSnapshot | undefined) {
  if (!snapshot) return { signature: null, signatureEvidence: null };
  const { dataUrl, ...signatureEvidence } = snapshot;
  return { signature: dataUrl, signatureEvidence };
}
