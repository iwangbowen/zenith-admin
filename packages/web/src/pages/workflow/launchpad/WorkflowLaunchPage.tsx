/**
 * 流程发起整页（多页签打开）
 *
 * 与发起工作台 SideSheet 等价的发起填写表单，作为独立系统多页签承载：
 * 标准字段（标题/优先级/抄送）+ 表单（设计器表单或自定义业务表单）+ 提交/存草稿。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Form, Space, Spin, Tabs, TabPane, Toast, Typography, Empty } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import dayjs from 'dayjs';
import type { WorkflowDefinition, WorkflowInstance } from '@zenith/shared';
import { request } from '@/utils/request';
import { useAuth } from '@/hooks/useAuth';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost, { type WorkflowBusinessFormApi } from '@/components/workflow/BusinessFormHost';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import WorkflowNodeListView from '@/components/workflow/WorkflowNodeListView';
import WorkflowApproverPreview from '@/components/workflow/WorkflowApproverPreview';
import { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import { useTabMeta } from '@/hooks/useTabMeta';

export default function WorkflowLaunchPage() {
  const { definitionId } = useParams<{ definitionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const defId = Number(definitionId);

  const [loading, setLoading] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);

  const formApi = useRef<FormApi | null>(null);
  const dynamicFormApi = useRef<FormApi | null>(null);
  const businessFormApi = useRef<WorkflowBusinessFormApi | null>(null);

  useEffect(() => {
    if (!Number.isFinite(defId)) return;
    setLoading(true);
    request.get<WorkflowDefinition>(`/api/workflows/definitions/${defId}`)
      .then((res) => {
        if (res.code === 0) {
          setDef(res.data);
          setTimeout(() => {
            const who = user?.nickname || user?.username || '我';
            formApi.current?.setValue('title', `${res.data.name} - ${who} - ${dayjs().format('YYYY-MM-DD')}`);
          }, 0);
        }
      })
      .finally(() => setLoading(false));
  }, [defId, user]);

  useEffect(() => {
    request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all')
      .then((res) => {
        if (res.code === 0 && res.data) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
      })
      .catch(() => { /* 抄送人选项加载失败不阻断发起 */ });
  }, []);

  useTabMeta({
    title: def ? `发起：${def.name}` : '发起申请',
    icon: def?.customForm?.icon ?? def?.categoryIcon ?? 'Send',
  });

  const collectFormData = useCallback(async () => {
    if (!formApi.current || !def) return null;
    try {
      const values = await formApi.current.validate() as Record<string, unknown>;
      let formData: Record<string, unknown> = {};
      if (def.formType === 'custom') {
        if (businessFormApi.current) formData = await businessFormApi.current.validate();
      } else if (dynamicFormApi.current && def.formFields && def.formFields.length > 0) {
        formData = await dynamicFormApi.current.validate() as Record<string, unknown>;
      }
      return { values, formData };
    } catch {
      return null;
    }
  }, [def]);

  const handleSubmit = async (asDraft: boolean) => {
    const result = await collectFormData();
    if (!result || !def) return;
    const { values, formData } = result;
    const setBusy = asDraft ? setSavingDraft : setSubmitting;
    setBusy(true);
    try {
      const res = await request.post<WorkflowInstance>('/api/workflows/instances', {
        definitionId: def.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        ...(asDraft ? { asDraft: true } : {}),
      });
      if (res.code === 0) {
        Toast.success(asDraft ? '草稿已保存' : '申请已提交');
        const newId = res.data?.id;
        if (!asDraft && newId) {
          navigate(`/workflow/instance/${newId}`, { replace: true, state: { tabTitle: String(values.title ?? '流程详情') } });
        } else {
          navigate('/workflow/instances', { replace: true });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading && !def) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  }
  if (!Number.isFinite(defId) || (!loading && !def)) {
    return <Empty title="流程定义不存在或未发布" style={{ padding: 60 }} />;
  }

  return (
    <div className="page-container" style={{ padding: 16, maxWidth: 880, margin: '0 auto' }}>
      <Typography.Title heading={5} style={{ marginTop: 0, marginBottom: 16 }}>
        {def ? `发起：${def.name}` : '发起申请'}
      </Typography.Title>

      <Form getFormApi={(api) => { formApi.current = api; }}>
        <Form.Input
          field="title"
          label="申请标题"
          placeholder="自动生成，可手动修改"
          rules={[{ required: true, message: '请填写申请标题' }]}
        />
        <Form.Select field="priority" label="优先级" style={{ width: '100%' }} initValue="normal" optionList={WORKFLOW_PRIORITY_OPTIONS} />
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
      </Form>

      {def && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
          <Tabs type="line" defaultActiveKey="form">
            <TabPane tab="填写表单" itemKey="form">
              {def.formType === 'custom' ? (
                <BusinessFormHost
                  key={`biz-${def.id}`}
                  customForm={def.customForm}
                  mode="create"
                  container="tab"
                  definitionId={def.id}
                  getFormApi={(api) => { businessFormApi.current = api; }}
                />
              ) : def.formFields && def.formFields.length > 0 ? (
                <WorkflowFormRenderer
                  key={`form-${def.id}`}
                  fields={def.formFields}
                  initValues={{}}
                  getFormApi={(api) => { dynamicFormApi.current = api; }}
                />
              ) : (
                <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>
              )}
            </TabPane>
            <TabPane tab="审批链路" itemKey="chain">
              <WorkflowApproverPreview
                definitionId={def.id}
                getFormData={() => (
                  def.formType === 'custom'
                    ? (businessFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
                    : (dynamicFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
                )}
              />
            </TabPane>
            <TabPane tab="流程图预览" itemKey="graph">
              <WorkflowGraphView flowData={def.flowData} />
            </TabPane>
            <TabPane tab="节点详情" itemKey="nodes">
              <WorkflowNodeListView flowData={def.flowData} />
            </TabPane>
          </Tabs>
        </div>
      )}

      <Space style={{ marginTop: 20, width: '100%', justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/workflow/launchpad')}>取消</Button>
        <Button loading={savingDraft} disabled={submitting} onClick={() => void handleSubmit(true)}>保存草稿</Button>
        <Button type="primary" loading={submitting} disabled={savingDraft} onClick={() => void handleSubmit(false)}>提交</Button>
      </Space>
    </div>
  );
}
