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
import { IllustrationFailure, IllustrationFailureDark } from '@douyinfe/semi-illustrations';
import type { WorkflowCustomFormConfig, WorkflowCustomFormVariable } from '@zenith/shared';
import { lazyPageComponent } from '@/utils/page-registry';

export type WorkflowBusinessFormMode = 'create' | 'view' | 'approve';

/** 业务页面向宿主暴露的命令式 API（创建/审批提交时由宿主调用） */
export interface WorkflowBusinessFormApi {
  /** 校验并返回业务表单数据；校验失败应 reject */
  validate: () => Promise<Record<string, unknown>>;
  /** 直接取当前值（不校验），可选 */
  getValues?: () => Record<string, unknown>;
}

/** 自定义业务表单组件接收的 props 契约 */
export interface WorkflowBusinessFormProps {
  /** create=发起填写，view=只读查看，approve=审批办理 */
  mode: WorkflowBusinessFormMode;
  /** 容器：sheet=嵌入抽屉（当前），tab=整页多页签（预留） */
  container: 'sheet' | 'tab';
  /** 所属流程定义 id */
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
  /** 关闭/返回回调（整页模式可用） */
  onClose?: () => void;
}

interface BusinessFormHostProps {
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
  onClose?: () => void;
}

function MissingComponent({ path }: Readonly<{ path: string | null }>) {
  return (
    <Empty
      image={<IllustrationFailure style={{ width: 140, height: 140 }} />}
      darkModeImage={<IllustrationFailureDark style={{ width: 140, height: 140 }} />}
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
  onClose,
}: Readonly<BusinessFormHostProps>) {
  // 创建用 createComponent；查看/审批优先 viewComponent，缺省回退 createComponent（只读）
  const componentPath = useMemo(() => {
    if (!customForm) return null;
    if (mode === 'create') return customForm.createComponent || null;
    return customForm.viewComponent || customForm.createComponent || null;
  }, [customForm, mode]);

  const Component = useMemo(() => lazyPageComponent(componentPath), [componentPath]);

  if (!Component) return <MissingComponent path={componentPath} />;

  const businessProps: WorkflowBusinessFormProps = {
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
    onClose,
  };

  return (
    <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
      <Component {...(businessProps as unknown as Record<string, unknown>)} />
    </Suspense>
  );
}
