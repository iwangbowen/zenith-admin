/**
 * 自定义业务表单宿主
 *
 * 将流程定义绑定的「自定义业务页面」（用户在 src/pages 下自行实现的 React 组件）
 * 按 mode/container 注入统一 props 后渲染。创建（发起工作台）与查看（我的申请等）
 * 共用本宿主，业务组件通过 props.mode 区分渲染；查看样式差异大时可另配 viewComponent。
 *
 * 业务页面契约见下方 `WorkflowBusinessFormProps`。
 */
import { Suspense, useMemo } from 'react';
import { Empty, Spin, Typography } from '@douyinfe/semi-ui';
import type { WorkflowCustomFormConfig, WorkflowCustomFormVariable } from '@zenith/shared/workflow';
import { lazyBusinessFormComponent } from '@/utils/business-form-registry';
import { emptyIllustration } from '@/components/EmptyIllustration';
import type { ApiClient } from '@/lib/contract-query';

export type WorkflowBusinessFormMode = 'create' | 'view' | 'approve' | 'action';

/** 业务页面向宿主暴露的命令式 API（创建/审批提交时由宿主调用） */
export interface WorkflowBusinessFormApi {
  /** 校验并返回业务表单数据；校验失败应 reject */
  validate: () => Promise<Record<string, unknown>>;
  /** 直接取当前值（不校验），可选 */
  getValues?: () => Record<string, unknown>;
  /** 动作成功后由业务组件刷新自身领域视图，公共流程层不依赖具体领域 hooks。 */
  onActionSuccess?: () => void;
  /** 业务值尚不足以预览时阻止公共容器发送预览请求。 */
  isPreviewReady?: () => boolean;
  /** 强制重算业务侧预览（如审批人、策略等与当前表单值无关的外部上下文变化）。 */
  refreshPreview?: () => void;
}

/** 自定义业务表单组件接收的 props 契约 */
export interface WorkflowBusinessFormProps {
  /** create=发起填写，view=只读查看，approve=审批办理，action=审批动作临时输入 */
  mode: WorkflowBusinessFormMode;
  requestClient?: ApiClient;
  /** 容器：sheet=嵌入抽屉（当前），tab=整页多页签（预留） */
  container: 'sheet' | 'tab';
  definitionId: number;
  /** 查看/审批时的实例 id；创建时为 null */
  instanceId?: number | null;
  /** 创建时为初始值；查看/审批时为已保存的业务 formData */
  value: Record<string, unknown>;
  /** 是否只读（view 模式恒为 true） */
  readOnly?: boolean;
  /** 业务实体接入（external 表单）：业务类型与业务记录主键，view 组件据此拉取业务数据 */
  bizType?: string | null;
  bizId?: string | null;
  /** 暴露给流程的变量声明（来自 customForm.variables），业务页据此写入 formData */
  variables?: WorkflowCustomFormVariable[];
  /** 注册命令式 API（create/approve 必需，供宿主提交时取值校验） */
  getFormApi?: (api: WorkflowBusinessFormApi) => void;
  /** 业务值变化后通知承载容器刷新审批预览。 */
  onValuesChange?: () => void;
  /** 关闭/返回回调（整页模式可用） */
  onClose?: () => void;
}

interface BusinessFormHostProps {
  requestClient?: ApiClient;
  customForm: WorkflowCustomFormConfig | null | undefined;
  mode: WorkflowBusinessFormMode;
  container?: 'sheet' | 'tab';
  definitionId: number;
  instanceId?: number | null;
  value?: Record<string, unknown>;
  readOnly?: boolean;
  bizType?: string | null;
  bizId?: string | null;
  getFormApi?: (api: WorkflowBusinessFormApi) => void;
  onValuesChange?: () => void;
  onClose?: () => void;
}

function MissingComponent({ path }: Readonly<{ path: string | null }>) {
  return (
    <Empty
      {...emptyIllustration('Failure', 140)}
      title="未找到业务表单组件"
      description={
        <Typography.Text type="tertiary">
          {path ? `组件路径「${path}」无对应页面，请确认已在 src/pages 下创建该组件` : '未配置业务表单组件路径'}
        </Typography.Text>
      }
      style={{ padding: '48px 0' }}
    />
  );
}

export default function BusinessFormHost({
  requestClient,
  customForm,
  mode,
  container = 'sheet',
  definitionId,
  instanceId = null,
  value,
  readOnly,
  bizType = null,
  bizId = null,
  getFormApi,
  onValuesChange,
  onClose,
}: Readonly<BusinessFormHostProps>) {
  // 创建用 createComponent；查看/审批优先 viewComponent，缺省回退 createComponent（只读）
  const componentPath = useMemo(() => {
    if (!customForm) return null;
    if (mode === 'action') return customForm.actionComponent || null;
    if (mode === 'create') return customForm.createComponent || null;
    return customForm.viewComponent || customForm.createComponent || null;
  }, [customForm, mode]);

  const Component = useMemo(() => lazyBusinessFormComponent(componentPath), [componentPath]);

  if (!Component) return mode === 'action' && !componentPath ? null : <MissingComponent path={componentPath} />;

  const businessProps: WorkflowBusinessFormProps = {
    requestClient,
    mode,
    container,
    definitionId,
    instanceId,
    value: value ?? {},
    readOnly: readOnly ?? mode === 'view',
    bizType,
    bizId,
    variables: customForm?.variables ?? [],
    getFormApi,
    onValuesChange,
    onClose,
  };

  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
      <Component {...(businessProps as unknown as Record<string, unknown>)} />
    </Suspense>
  );
}
