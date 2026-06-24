/**
 * 流程发起表单主体（发起工作台 SideSheet 与发起整页共用）
 *
 * 封装标准字段（标题/优先级/抄送）+ 4 个页签（填写表单/审批链路/流程图预览/节点详情）
 * 及取数校验逻辑，通过 ref 暴露 collectFormData 供外层提交/存草稿调用。
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Banner, Col, Form, Row, Tabs, TabPane, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import dayjs from 'dayjs';
import type { WorkflowDefinition } from '@zenith/shared';
import { useAuth } from '@/hooks/useAuth';
import { useUserOptions } from '@/hooks/useUserOptions';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { resolveDynamicDefaults } from '@/pages/workflow/designer/form-defaults';
import BusinessFormHost, { type WorkflowBusinessFormApi } from '@/components/workflow/BusinessFormHost';
import WorkflowFlowTab from '@/components/workflow/WorkflowFlowTab';
import WorkflowApproverPreview from '@/components/workflow/WorkflowApproverPreview';
import { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';

export interface WorkflowLaunchFormData {
  values: Record<string, unknown>;
  formData: Record<string, unknown>;
}

export interface WorkflowLaunchFormHandle {
  collectFormData: () => Promise<WorkflowLaunchFormData | null>;
}

interface WorkflowLaunchFormProps {
  def: WorkflowDefinition;
  /** 业务自定义表单的承载容器，影响 BusinessFormHost 布局 */
  container: 'tab' | 'sheet';
  /** 动态表单初始值（草稿/编辑回填） */
  initialFormData?: Record<string, unknown>;
  /** 申请标题初始值（草稿/编辑回填，留空则自动生成） */
  initialTitle?: string;
}

const WorkflowLaunchForm = forwardRef<WorkflowLaunchFormHandle, WorkflowLaunchFormProps>(
  function WorkflowLaunchForm({ def, container, initialFormData, initialTitle }, ref) {
    const { user } = useAuth();
    const formApi = useRef<FormApi | null>(null);
    const dynamicFormApi = useRef<FormApi | null>(null);
    const businessFormApi = useRef<WorkflowBusinessFormApi | null>(null);
    const { userOptions } = useUserOptions({ immediate: true });

    useEffect(() => {
      const who = user?.nickname || user?.username || '我';
      const title = initialTitle?.trim() || `${def.name} - ${who} - ${dayjs().format('YYYY-MM-DD')}`;
      const timer = setTimeout(() => formApi.current?.setValue('title', title), 0);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [def.id]);

    useImperativeHandle(ref, () => ({
      collectFormData: async () => {
        if (!formApi.current) return null;
        if (def.formType === 'external') {
          Toast.error('业务系统主导流程请从对应业务模块发起');
          return null;
        }
        try {
          const values = await formApi.current.validate() as Record<string, unknown>;
          let formData: Record<string, unknown> = {};
          if (def.formType === 'custom') {
            if (!businessFormApi.current) {
              Toast.error('业务表单尚未就绪，请稍候重试');
              return null;
            }
            formData = await businessFormApi.current.validate();
          } else if (dynamicFormApi.current && def.formFields && def.formFields.length > 0) {
            formData = await dynamicFormApi.current.validate() as Record<string, unknown>;
          }
          return { values, formData };
        } catch {
          return null;
        }
      },
    }), [def]);

    const getPreviewFormData = () => (
      def.formType === 'custom'
        ? (businessFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
        : (dynamicFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
    );

    // 动态默认值（${currentUser}/${today} 等）按发起人解析，被草稿/编辑回填覆盖
    const dynamicDefaults = useMemo(() => (
      def.formFields && def.formFields.length > 0
        ? resolveDynamicDefaults(def.formFields, {
            userName: user?.nickname || user?.username,
            userId: user?.id,
            deptName: user?.departmentName ?? undefined,
            deptId: user?.departmentId ?? undefined,
          })
        : {}
    ), [def.formFields, user]);

    const renderFormBody = () => {
      if (def.formType === 'external') {
        return (
          <Banner
            type="warning"
            closeIcon={null}
            description="业务系统主导流程由业务模块保存业务数据后发起，不能在工作流发起页直接提交。请返回对应业务模块创建申请。"
          />
        );
      }
      if (def.formType === 'custom') {
        return (
          <BusinessFormHost
            key={`biz-${def.id}`}
            customForm={def.customForm}
            mode="create"
            container={container}
            definitionId={def.id}
            getFormApi={(api) => { businessFormApi.current = api; }}
          />
        );
      }
      if (def.formFields && def.formFields.length > 0) {
        return (
          <WorkflowFormRenderer
            key={`form-${def.id}`}
            fields={def.formFields}
            initValues={{ ...dynamicDefaults, ...(initialFormData ?? {}) }}
            getFormApi={(api) => { dynamicFormApi.current = api; }}
          />
        );
      }
      return <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>;
    };

    return (
      <>
        <Form getFormApi={(api) => { formApi.current = api; }}>
          <Form.Input
            field="title"
            label="申请标题"
            placeholder="自动生成，可手动修改"
            rules={[{ required: true, message: '请填写申请标题' }]}
          />
          <Row gutter={16}>
            <Col span={8}>
              <Form.Select field="priority" label="优先级" style={{ width: '100%' }} initValue="normal" optionList={WORKFLOW_PRIORITY_OPTIONS} />
            </Col>
            <Col span={16}>
              <Form.Select
                field="ccUserIds"
                label="抄送人"
                placeholder="可选，提交后立即抄送给所选成员"
                multiple
                filter
                showClear
                style={{ width: '100%' }}
                optionList={userOptions}
              />
            </Col>
          </Row>
        </Form>

        <div style={{ marginTop: 16, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
          <Tabs type="line" defaultActiveKey="form">
            <TabPane tab="填写表单" itemKey="form">
              {renderFormBody()}
            </TabPane>
            <TabPane tab="审批链路" itemKey="chain">
              <WorkflowApproverPreview definitionId={def.id} getFormData={getPreviewFormData} />
            </TabPane>
            <TabPane tab="流程图" itemKey="graph">
              <WorkflowFlowTab flowData={def.flowData} initiator={user ? { name: user.nickname, avatar: user.avatar } : undefined} />
            </TabPane>
          </Tabs>
        </div>
      </>
    );
  },
);

export default WorkflowLaunchForm;
