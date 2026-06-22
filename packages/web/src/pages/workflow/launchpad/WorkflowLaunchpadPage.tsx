import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Form, Input, List, Space, SideSheet, Spin, Tabs, TabPane, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ExternalLink, RotateCcw, Search, Send } from 'lucide-react';
import type { WorkflowDefinition } from '@zenith/shared';
import { request } from '@/utils/request';
import { useAuth } from '@/hooks/useAuth';
import { SearchToolbar } from '@/components/SearchToolbar';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost, { type WorkflowBusinessFormApi } from '@/components/workflow/BusinessFormHost';
import WorkflowGraphView from '@/components/workflow/WorkflowGraphView';
import WorkflowNodeListView from '@/components/workflow/WorkflowNodeListView';
import WorkflowApproverPreview from '@/components/workflow/WorkflowApproverPreview';
import { WORKFLOW_PRIORITY_OPTIONS } from '@/components/workflow/WorkflowPriorityTag';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';

const UNCATEGORIZED = -1;

export default function WorkflowLaunchpadPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { categories } = useWorkflowCategories();
  const [loading, setLoading] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [keyword, setKeyword] = useState('');
  const [activeKeyword, setActiveKeyword] = useState('');

  const formApi = useRef<FormApi | null>(null);
  const dynamicFormApi = useRef<FormApi | null>(null);
  const businessFormApi = useRef<WorkflowBusinessFormApi | null>(null);
  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedDef, setSelectedDef] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<WorkflowDefinition[]>('/api/workflows/definitions/published');
      if (res.code === 0) setDefinitions(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userOptions.length === 0) {
      request.get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all')
        .then((res) => {
          if (res.code === 0 && res.data) setUserOptions(res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id })));
        })
        .catch(() => { /* 抄送人选项加载失败不阻断发起 */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const categoryName = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const grouped = useMemo(() => {
    const kw = activeKeyword.trim().toLowerCase();
    const filtered = kw
      ? definitions.filter((d) => d.name.toLowerCase().includes(kw) || (d.description ?? '').toLowerCase().includes(kw))
      : definitions;
    const groups = new Map<number, WorkflowDefinition[]>();
    for (const d of filtered) {
      const cid = d.categoryId ?? UNCATEGORIZED;
      if (!groups.has(cid)) groups.set(cid, []);
      groups.get(cid)!.push(d);
    }
    return Array.from(groups.entries()).map(([cid, defs]) => ({
      categoryId: cid,
      categoryName: cid === UNCATEGORIZED ? '未分类' : (categoryName.get(cid) ?? '未分类'),
      defs,
    }));
  }, [definitions, activeKeyword, categoryName]);

  const openApply = (def: WorkflowDefinition) => {
    setSelectedDef(def);
    setFormKey((k) => k + 1);
    setApplyVisible(true);
    setTimeout(() => {
      const who = user?.nickname || user?.username || '我';
      formApi.current?.setValue('title', `${def.name} - ${who} - ${dayjs().format('YYYY-MM-DD')}`);
    }, 0);
  };

  const closeApply = () => {
    setApplyVisible(false);
    setSelectedDef(null);
  };

  const collectFormData = async () => {
    if (!formApi.current || !selectedDef) return null;
    try {
      const values = await formApi.current.validate() as Record<string, unknown>;
      let formData: Record<string, unknown> = {};
      if (selectedDef.formType === 'custom') {
        if (!businessFormApi.current) {
          Toast.error('业务表单尚未就绪，请稍候重试');
          return null;
        }
        formData = await businessFormApi.current.validate();
      } else if (dynamicFormApi.current && selectedDef.formFields && selectedDef.formFields.length > 0) {
        formData = await dynamicFormApi.current.validate() as Record<string, unknown>;
      }
      return { values, formData };
    } catch {
      return null;
    }
  };

  const handleSubmit = async (asDraft: boolean) => {
    const result = await collectFormData();
    if (!result || !selectedDef) return;
    const { values, formData } = result;
    const setBusy = asDraft ? setSavingDraft : setSubmitting;
    setBusy(true);
    try {
      const res = await request.post('/api/workflows/instances', {
        definitionId: selectedDef.id,
        title: values.title,
        formData,
        priority: values.priority ?? 'normal',
        ccUserIds: Array.isArray(values.ccUserIds) ? values.ccUserIds : undefined,
        ...(asDraft ? { asDraft: true } : {}),
      });
      if (res.code === 0) {
        Toast.success(asDraft ? '草稿已保存' : '申请已提交');
        closeApply();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = () => setActiveKeyword(keyword);
  const handleReset = () => { setKeyword(''); setActiveKeyword(''); };

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索流程名称 / 说明"
          value={keyword}
          onChange={setKeyword}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 240 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : grouped.length === 0 ? (
        <Empty title="暂无可发起的流程" description="请联系管理员发布流程定义" style={{ padding: 60 }} />
      ) : (
        <div style={{ padding: '4px 0 16px' }}>
          {grouped.map((group) => (
            <div key={group.categoryId} style={{ marginBottom: 24 }}>
              <Typography.Title heading={6} style={{ margin: '8px 0 12px' }}>{group.categoryName}</Typography.Title>
              <List
                grid={{ gutter: 12, xs: 24, sm: 12, md: 8, lg: 6, xl: 6, xxl: 4 }}
                dataSource={group.defs}
                split={false}
                renderItem={(def) => (
                  <List.Item style={{ padding: '0 0 12px' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openApply(def)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openApply(def); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Card
                        shadows="hover"
                        bodyStyle={{ padding: 16 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
                          <div
                            style={{
                              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: def.categoryColor ?? 'var(--semi-color-primary-light-default)',
                              color: '#fff',
                            }}
                          >
                            <Send size={20} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{def.name}</Typography.Text>
                            <Typography.Paragraph
                              type="tertiary"
                              size="small"
                              ellipsis={{ rows: 2, showTooltip: true }}
                              style={{ marginTop: 4, marginBottom: 0, minHeight: 36, lineHeight: '18px' }}
                            >
                              {def.description || '点击发起该流程'}
                            </Typography.Paragraph>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          ))}
        </div>
      )}

      <SideSheet
        title={selectedDef ? `发起：${selectedDef.name}` : '发起申请'}
        visible={applyVisible}
        onCancel={closeApply}
        width={720}
        bodyStyle={{ padding: 16 }}
        footer={
          <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
            <Button
              theme="borderless"
              icon={<ExternalLink size={14} />}
              onClick={() => {
                if (!selectedDef) return;
                const icon = selectedDef.customForm?.icon ?? selectedDef.categoryIcon ?? 'Send';
                navigate(`/workflow/launch/${selectedDef.id}`, { state: { tabTitle: `发起：${selectedDef.name}`, tabIcon: icon } });
              }}
            >
              在新页签打开
            </Button>
            <Space>
              <Button onClick={closeApply}>取消</Button>
              <Button loading={savingDraft} disabled={submitting} onClick={() => void handleSubmit(true)}>保存草稿</Button>
              <Button type="primary" loading={submitting} disabled={savingDraft} onClick={() => void handleSubmit(false)}>提交</Button>
            </Space>
          </div>
        }
      >
        <Form getFormApi={(api) => { formApi.current = api; }}>
          <Form.Input
            field="title"
            label="申请标题"
            placeholder="自动生成，可手动修改"
            rules={[{ required: true, message: '请填写申请标题' }]}
          />
          <Form.Select
            field="priority"
            label="优先级"
            style={{ width: '100%' }}
            initValue="normal"
            optionList={WORKFLOW_PRIORITY_OPTIONS}
          />
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
        {selectedDef && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
            <Tabs type="line" defaultActiveKey="form">
              <TabPane tab="填写表单" itemKey="form">
                {selectedDef.formType === 'custom' ? (
                  <BusinessFormHost
                    key={`biz-${formKey}-${selectedDef.id}`}
                    customForm={selectedDef.customForm}
                    mode="create"
                    container="sheet"
                    definitionId={selectedDef.id}
                    getFormApi={(api) => { businessFormApi.current = api; }}
                  />
                ) : selectedDef.formFields && selectedDef.formFields.length > 0 ? (
                  <WorkflowFormRenderer
                    key={`form-${formKey}-${selectedDef.id}`}
                    fields={selectedDef.formFields}
                    initValues={{}}
                    getFormApi={(api) => { dynamicFormApi.current = api; }}
                  />
                ) : (
                  <Typography.Text type="tertiary">该流程未配置表单字段</Typography.Text>
                )}
              </TabPane>
              <TabPane tab="审批链路" itemKey="chain">
                <WorkflowApproverPreview
                  definitionId={selectedDef.id}
                  getFormData={() => (
                    selectedDef.formType === 'custom'
                      ? (businessFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
                      : (dynamicFormApi.current?.getValues?.() as Record<string, unknown>) ?? {}
                  )}
                />
              </TabPane>
              <TabPane tab="流程图预览" itemKey="graph">
                <WorkflowGraphView flowData={selectedDef.flowData} />
              </TabPane>
              <TabPane tab="节点详情" itemKey="nodes">
                <WorkflowNodeListView flowData={selectedDef.flowData} />
              </TabPane>
            </Tabs>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
