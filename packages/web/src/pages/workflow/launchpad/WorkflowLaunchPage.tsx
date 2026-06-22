/**
 * 流程发起整页（多页签打开）
 *
 * 与发起工作台 SideSheet 等价的发起填写表单，作为独立系统多页签承载：
 * 标准字段（标题/优先级/抄送）+ 表单（设计器表单或自定义业务表单）+ 提交/存草稿。
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Banner, Button, Col, Divider, Form, Row, SideSheet, Space, Spin, Tabs, TabPane, Toast, Typography, Empty } from '@douyinfe/semi-ui';
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
import { useTabMeta, TabsMetaContext } from '@/hooks/useTabMeta';

export default function WorkflowLaunchPage() {
  const { definitionId } = useParams<{ definitionId: string }>();
  const navigate = useNavigate();
  const tabsCtx = useContext(TabsMetaContext);
  const { user } = useAuth();
  const defId = Number(definitionId);

  const [loading, setLoading] = useState(false);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<'graph' | 'nodes'>('graph');

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
  const isExternal = def?.formType === 'external';

  const collectFormData = useCallback(async () => {
    if (!formApi.current || !def) return null;
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
          navigate(`/workflow/instance/${newId}`, { state: { tabTitle: String(values.title ?? '流程详情') } });
        } else {
          navigate('/workflow/instances');
        }
        // 关闭当前发起整页标签，避免遗留已消费的“发起：X”标签
        tabsCtx?.closeTab(`/workflow/launch/${definitionId}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const getPreviewFormData = () => (
    def?.formType === 'custom'
      ? (businessFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
      : (dynamicFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
  );

  const renderFormBody = () => {
    if (!def) return null;
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
          container="tab"
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
          initValues={{}}
          getFormApi={(api) => { dynamicFormApi.current = api; }}
        />
      );
    }
    return <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>;
  };

  if (loading && !def) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  }
  if (!Number.isFinite(defId) || (!loading && !def)) {
    return <Empty title="流程定义不存在或未发布" style={{ padding: 60 }} />;
  }

  return (
    <div className="page-container" style={{ padding: 16, maxWidth: 1120, margin: '0 auto' }}>
      <Typography.Title heading={5} style={{ marginTop: 0, marginBottom: 16 }}>
        {def ? `发起：${def.name}` : '发起申请'}
      </Typography.Title>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 主区：连续表单（基本信息 + 业务表单），突出填写 */}
        <div style={{ flex: '1 1 520px', minWidth: 0, maxWidth: 760 }}>
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

          <Divider margin={16} />
          <Typography.Title heading={6} style={{ marginTop: 0, marginBottom: 12 }}>表单内容</Typography.Title>
          {renderFormBody()}
        </div>

        {/* 右栏：审批链路预览（吸顶），流程图/节点详情按需弹出 */}
        <div style={{ flex: '0 0 300px', width: 300, position: 'sticky', top: 16, alignSelf: 'flex-start' }}>
          <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, background: 'var(--semi-color-bg-1)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--semi-color-border)' }}>
              <Typography.Text strong>审批链路</Typography.Text>
              <Space spacing={2}>
                <Button size="small" theme="borderless" onClick={() => { setPreviewKey('graph'); setPreviewOpen(true); }}>流程图</Button>
                <Button size="small" theme="borderless" onClick={() => { setPreviewKey('nodes'); setPreviewOpen(true); }}>节点</Button>
              </Space>
            </div>
            <div style={{ padding: 12, maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
              {def && <WorkflowApproverPreview definitionId={def.id} getFormData={getPreviewFormData} />}
            </div>
          </div>
        </div>
      </div>

      {/* 吸底操作栏，始终可见 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          marginTop: 16,
          paddingTop: 12,
          paddingBottom: 4,
          borderTop: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-bg-1)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <Button onClick={() => navigate('/workflow/launchpad')}>取消</Button>
        <Button loading={savingDraft} disabled={submitting || isExternal} onClick={() => void handleSubmit(true)}>保存草稿</Button>
        <Button type="primary" loading={submitting} disabled={savingDraft || isExternal} onClick={() => void handleSubmit(false)}>提交</Button>
      </div>

      {/* 流程图 / 节点详情按需预览 */}
      <SideSheet title="流程预览" visible={previewOpen} onCancel={() => setPreviewOpen(false)} width={720}>
        {def && (
          <Tabs type="line" activeKey={previewKey} onChange={(k) => setPreviewKey(k as 'graph' | 'nodes')}>
            <TabPane tab="流程图预览" itemKey="graph">
              <WorkflowGraphView flowData={def.flowData} />
            </TabPane>
            <TabPane tab="节点详情" itemKey="nodes">
              <WorkflowNodeListView flowData={def.flowData} initiator={user ? { name: user.nickname, avatar: user.avatar } : undefined} />
            </TabPane>
          </Tabs>
        )}
      </SideSheet>
    </div>
  );
}
