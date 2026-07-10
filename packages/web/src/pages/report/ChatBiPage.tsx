import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Modal,
  Pagination,
  Radio,
  RadioGroup,
  Space,
  Spin,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import {
  Archive,
  BarChart3,
  Bot,
  Database,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Send,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react';
import type {
  ReportChatbiMessage,
  ReportChatbiSavedResource,
  ReportChatbiSession,
  ReportWidgetType,
} from '@zenith/shared';
import { REPORT_CHATBI_SESSION_STATUS_LABELS } from '@zenith/shared';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListItem, NavListPanel } from '@/components/NavListPanel';
import AppModal from '@/components/AppModal';
import MarkdownPreviewPanel from '@/components/MarkdownPreviewPanel';
import { WidgetRenderer } from './widgets/WidgetRenderer';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  reportChatbiKeys,
  useArchiveReportChatbiSession,
  useAskReportChatbi,
  useCreateReportChatbiSession,
  useDeleteReportChatbiSession,
  useReportChatbiQuota,
  useReportChatbiSessionDetail,
  useReportChatbiSessionList,
  useSaveReportChatbiMessageAsset,
  useUpdateReportChatbiSession,
} from '@/hooks/queries/report-chatbi';
import { useEnabledReportDatasets, useEnabledReportDatasources } from '@/hooks/queries/report-datasets';
import {
  useReportDashboardDetail,
  useReportDashboardLookup,
} from '@/hooks/queries/report-dashboards';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/query';
import {
  buildChatbiDataResult,
  buildSafeChatbiWidget,
  chatbiRequestErrorMessage,
  getChatbiSavedResourceAction,
  supportedChatbiChartTypes,
} from './report-p2-utils';
import './ChatBiPage.css';

function StructuredAnswer({
  message,
  datasetId,
  canSave,
  onSave,
  onOpenSaved,
}: Readonly<{
  message: ReportChatbiMessage;
  datasetId?: number | null;
  canSave: boolean;
  onSave: (message: ReportChatbiMessage) => void;
  onOpenSaved: (message: ReportChatbiMessage) => void;
}>) {
  const chartTypes = supportedChatbiChartTypes(message);
  const [chartType, setChartType] = useState<ReportWidgetType>(() => (
    chartTypes.includes(message.chartSuggestion?.type ?? 'table')
      ? message.chartSuggestion?.type ?? 'table'
      : 'table'
  ));
  const result = useMemo(() => buildChatbiDataResult(message), [message]);
  const widget = useMemo(
    () => buildSafeChatbiWidget(message, chartType, datasetId),
    [chartType, datasetId, message],
  );
  const savedAction = getChatbiSavedResourceAction(message);

  return (
    <div className="chatbi-answer">
      <MarkdownPreviewPanel content={message.content} style={{ height: 'auto', overflow: 'visible' }} />
      {message.errorMessage && (
        <Banner type="danger" closeIcon={null} description={message.errorMessage} />
      )}
      {message.generatedSql && (
        <Collapse>
          <Collapse.Panel itemKey="sql" header="查看生成的只读 SQL">
            <pre className="chatbi-answer__sql">{message.generatedSql}</pre>
          </Collapse.Panel>
        </Collapse>
      )}
      {message.resultSample.length > 0 && (
        <div className="chatbi-answer__result">
          <div className="chatbi-answer__result-toolbar">
            <Space wrap>
              {chartTypes.map((type) => (
                <Button
                  key={type}
                  size="small"
                  theme={chartType === type ? 'solid' : 'borderless'}
                  type={chartType === type ? 'primary' : 'tertiary'}
                  onClick={() => setChartType(type)}
                >
                  {type}
                </Button>
              ))}
            </Space>
            <Typography.Text type="tertiary" size="small">
              {message.resultRowCount} 行 · 展示前 {message.resultSample.length} 行
            </Typography.Text>
          </div>
          <div className="chatbi-answer__widget">
            <WidgetRenderer widget={widget} data={result} />
          </div>
        </div>
      )}
      <Space className="chatbi-answer__actions">
        {canSave && message.generatedSql && !savedAction && (
          <Button theme="borderless" size="small" icon={<Save size={14} />} onClick={() => onSave(message)}>
            保存为治理资源
          </Button>
        )}
        {savedAction && (
          <Button theme="borderless" size="small" icon={<BarChart3 size={14} />} onClick={() => onOpenSaved(message)}>
            {savedAction.label}
          </Button>
        )}
      </Space>
    </div>
  );
}

export default function ChatBiPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage } = usePagination(20);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [activeSessionId, setActiveSessionId] = useState<number>();
  const [createVisible, setCreateVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ReportChatbiSession | null>(null);
  const [saveTarget, setSaveTarget] = useState<ReportChatbiMessage | null>(null);
  const [contextType, setContextType] = useState<'dataset' | 'datasource'>('dataset');
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [askError, setAskError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<ReportChatbiSavedResource | null>(null);
  const [targetDashboardId, setTargetDashboardId] = useState<number>();
  const [saveResourceType, setSaveResourceType] = useState<'dataset' | 'dashboard'>('dataset');
  const [saveMode, setSaveMode] = useState<'new' | 'existing'>('new');
  const abortRef = useRef<AbortController | null>(null);
  const createFormApi = useRef<FormApi | null>(null);
  const renameFormApi = useRef<FormApi | null>(null);
  const saveFormApi = useRef<FormApi | null>(null);

  const listQuery = useReportChatbiSessionList({
    page,
    pageSize,
    keyword: submittedKeyword || undefined,
    status,
  });
  const detailQuery = useReportChatbiSessionDetail(activeSessionId);
  const quotaQuery = useReportChatbiQuota();
  const datasourceQuery = useEnabledReportDatasources(undefined, createVisible && contextType === 'datasource');
  const datasetQuery = useEnabledReportDatasets(undefined, createVisible && contextType === 'dataset');
  const dashboardLookupQuery = useReportDashboardLookup(
    { status: 'enabled', limit: 100 },
    Boolean(saveTarget),
  );
  const dashboardDetailQuery = useReportDashboardDetail(targetDashboardId, Boolean(saveTarget && targetDashboardId), 'draft');
  const createMutation = useCreateReportChatbiSession();
  const updateMutation = useUpdateReportChatbiSession();
  const archiveMutation = useArchiveReportChatbiSession();
  const deleteMutation = useDeleteReportChatbiSession();
  const askMutation = useAskReportChatbi();
  const saveMutation = useSaveReportChatbiMessageAsset();
  const sessions = listQuery.data?.list ?? [];
  const detail = detailQuery.data;
  const quota = quotaQuery.data;

  const selectSession = (session: ReportChatbiSession) => {
    setActiveSessionId(session.id);
    setAskError(null);
    setLastSaved(null);
  };

  async function handleCreate() {
    const values = await createFormApi.current?.validate() as Record<string, unknown>;
    const selectedId = Number(values.contextId);
    const session = await createMutation.mutateAsync({
      title: String(values.title),
      ...(contextType === 'dataset' ? { datasetId: selectedId } : { datasourceId: selectedId }),
      allowedTables: [],
    });
    Toast.success('会话创建成功');
    setCreateVisible(false);
    setActiveSessionId(session.id);
  }

  async function handleRename() {
    if (!renameTarget) return;
    const values = await renameFormApi.current?.validate() as { title: string };
    await updateMutation.mutateAsync({ id: renameTarget.id, values: { title: values.title } });
    Toast.success('会话名称已更新');
    setRenameTarget(null);
  }

  async function handleAsk() {
    const content = question.trim();
    if (!activeSessionId || !content || askMutation.isPending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setQuestion('');
    setPendingQuestion(content);
    setAskError(null);
    try {
      await askMutation.mutateAsync({
        sessionId: activeSessionId,
        values: { content, requestChart: true, maxRows: 100 },
        signal: controller.signal,
      });
    } catch (error) {
      setAskError(chatbiRequestErrorMessage(error, controller.signal.aborted));
    } finally {
      setPendingQuestion('');
      abortRef.current = null;
    }
  }

  async function handleSaveResource() {
    if (!saveTarget || !activeSessionId) return;
    const values = await saveFormApi.current?.validate() as Record<string, unknown>;
    const resourceType = values.resourceType as 'dataset' | 'dashboard';
    const existingDashboardId = resourceType === 'dashboard' && values.saveMode === 'existing'
      ? Number(values.targetDashboardId)
      : undefined;
    if (existingDashboardId && !dashboardDetailQuery.data) {
      throw new Error('目标仪表盘尚未加载，请稍后重试');
    }
    try {
      const resource = await saveMutation.mutateAsync({
        messageId: saveTarget.id,
        sessionId: activeSessionId,
        values: {
          resourceType,
          name: values.name ? String(values.name) : undefined,
          targetDashboardId: existingDashboardId,
          expectedDashboardRevision: existingDashboardId ? dashboardDetailQuery.data?.revision : undefined,
        },
      });
      setLastSaved(resource);
      setSaveTarget(null);
      setTargetDashboardId(undefined);
      Toast.success('治理资源保存成功');
    } catch (error) {
      if (error instanceof ApiError && error.code === 409 && existingDashboardId) {
        Modal.warning({
          title: '仪表盘修订冲突',
          content: '目标仪表盘已被其他人更新。请刷新最新修订后再次添加，系统不会覆盖他人的修改。',
          onOk: () => void dashboardDetailQuery.refetch(),
        });
        return;
      }
      throw error;
    }
  }

  function openSaved(message: ReportChatbiMessage) {
    if (message.savedDashboardId) {
      navigate(`/report/dashboards/${message.savedDashboardId}/view`);
    } else if (message.savedDatasetId) {
      navigate(`/report/datasets?resourceId=${message.savedDatasetId}`);
    }
  }

  const master = (
    <div className="chatbi-master">
      <NavListPanel
        title="智能问数"
        headerExtra={hasPermission('report:chatbi:create') ? (
          <Button
            theme="borderless"
            size="small"
            icon={<Plus size={15} />}
            onClick={() => setCreateVisible(true)}
            aria-label="新建会话"
          />
        ) : undefined}
        search={{
          value: keyword,
          onChange: setKeyword,
          placeholder: '搜索会话',
          onEnterPress: () => {
            setPage(1);
            setSubmittedKeyword(keyword.trim());
            void queryClient.invalidateQueries({ queryKey: reportChatbiKeys.lists });
          },
        }}
        loading={listQuery.isFetching}
        emptyText="暂无会话，创建一个数据上下文开始提问"
        dataSource={sessions}
        renderItem={(session) => (
          <NavListItem
            key={session.id}
            active={session.id === activeSessionId}
            onClick={() => selectSession(session)}
            icon={<Database size={15} />}
            primary={session.title}
            secondary={REPORT_CHATBI_SESSION_STATUS_LABELS[session.status]}
            meta={session.lastMessageAt ? formatDateTime(session.lastMessageAt) : formatDateTime(session.createdAt)}
            extra={(
              <Dropdown
                trigger="click"
                clickToHide
                position="bottomRight"
                render={(
                  <Dropdown.Menu>
                    {hasPermission('report:chatbi:update') && (
                      <Dropdown.Item icon={<Pencil size={14} />} onClick={() => setRenameTarget(session)}>重命名</Dropdown.Item>
                    )}
                    {hasPermission('report:chatbi:update') && session.status === 'active' && (
                      <Dropdown.Item icon={<Archive size={14} />} onClick={() => void archiveMutation.mutateAsync(session.id)}>
                        归档
                      </Dropdown.Item>
                    )}
                    {hasPermission('report:chatbi:delete') && (
                      <Dropdown.Item
                        type="danger"
                        icon={<Trash2 size={14} />}
                        onClick={() => Modal.confirm({
                          title: '删除会话？',
                          content: '会话及历史消息将永久删除。',
                          onOk: async () => {
                            await deleteMutation.mutateAsync(session.id);
                            if (activeSessionId === session.id) setActiveSessionId(undefined);
                          },
                        })}
                      >
                        删除
                      </Dropdown.Item>
                    )}
                  </Dropdown.Menu>
                )}
              >
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} onClick={(event) => event.stopPropagation()} />
              </Dropdown>
            )}
          />
        )}
        footer={listQuery.data && listQuery.data.total > pageSize ? (
          <Pagination
            size="small"
            currentPage={page}
            pageSize={pageSize}
            total={listQuery.data.total}
            showSizeChanger={false}
            onPageChange={setPage}
          />
        ) : undefined}
      />
      <div className="chatbi-master__status">
        <RadioGroup
          type="button"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as 'active' | 'archived');
            setPage(1);
          }}
        >
          <Radio value="active">进行中</Radio>
          <Radio value="archived">已归档</Radio>
        </RadioGroup>
      </div>
    </div>
  );

  let detailContent;
  if (!activeSessionId) {
    detailContent = <Empty title="选择或新建会话" description="ChatBI 只会访问会话创建时冻结的数据上下文。" />;
  } else if (detailQuery.isLoading) {
    detailContent = <Spin size="large" />;
  } else if (detailQuery.isError) {
    detailContent = (
      <Banner
        type="danger"
        closeIcon={null}
        description={chatbiRequestErrorMessage(detailQuery.error)}
      />
    );
  } else {
    detailContent = (
      <>
        <MasterDetailLayout.Header
          extra={quota ? (
            <Tag color="blue">
              今日 {quota.aiRequestsToday} 次 / {quota.queryRowsToday} 行 / {quota.queryCostUnitsToday.toFixed(2)} 成本
            </Tag>
          ) : null}
        >
          <Bot size={18} />
          <div>
            <Typography.Text strong>{detail?.session.title}</Typography.Text>
            <div className="chatbi-detail__context">
              {detail?.session.contextSnapshot.datasourceName}
              {detail?.session.datasetId ? ` · 数据集 #${detail.session.datasetId}` : ''}
            </div>
          </div>
        </MasterDetailLayout.Header>
        <MasterDetailLayout.Body className="chatbi-messages">
          {detail?.messages.map((message) => (
            <div key={message.id} className={`chatbi-message chatbi-message--${message.role}`}>
              <div className="chatbi-message__avatar">
                {message.role === 'user' ? <UserRound size={16} /> : <Bot size={16} />}
              </div>
              <div className="chatbi-message__body">
                {message.role === 'assistant' ? (
                  <StructuredAnswer
                    message={message}
                    datasetId={detail.session.datasetId}
                    canSave={hasPermission('report:chatbi:save')}
                    onSave={(target) => {
                      setLastSaved(null);
                      setSaveResourceType('dataset');
                      setSaveMode('new');
                      setSaveTarget(target);
                    }}
                    onOpenSaved={openSaved}
                  />
                ) : (
                  <div className="chatbi-message__plain">{message.content}</div>
                )}
                <div className="chatbi-message__time">{formatDateTime(message.createdAt)}</div>
              </div>
            </div>
          ))}
          {pendingQuestion && (
            <>
              <div className="chatbi-message chatbi-message--user">
                <div className="chatbi-message__avatar"><UserRound size={16} /></div>
                <div className="chatbi-message__body"><div className="chatbi-message__plain">{pendingQuestion}</div></div>
              </div>
              <div className="chatbi-message chatbi-message--assistant">
                <div className="chatbi-message__avatar"><Bot size={16} /></div>
                <div className="chatbi-message__body"><Spin tip="正在生成受治理查询并执行…" /></div>
              </div>
            </>
          )}
          {askError && <Banner type={askError.includes('取消') ? 'warning' : 'danger'} closeIcon={null} description={askError} />}
          {lastSaved && (
            <div>
              <Banner type="success" closeIcon={null} description={`已保存「${lastSaved.name}」`} />
              <div className="chatbi-saved-action">
                <Button
                  theme="borderless"
                  onClick={() => navigate(lastSaved.resourceType === 'dashboard'
                    ? `/report/dashboards/${lastSaved.resourceId}/view`
                    : `/report/datasets?resourceId=${lastSaved.resourceId}`)}
                >
                  打开资源
                </Button>
              </div>
            </div>
          )}
        </MasterDetailLayout.Body>
        <div className="chatbi-composer">
          {detail?.session.status === 'archived' ? (
            <Banner type="warning" closeIcon={null} description="该会话已归档，仅可查看历史。" />
          ) : (
            <Space align="end" style={{ width: '100%' }}>
              <TextArea
                value={question}
                onChange={setQuestion}
                placeholder="输入业务问题。Ctrl / ⌘ + Enter 发送"
                autosize={{ minRows: 2, maxRows: 6 }}
                maxCount={4000}
                disabled={askMutation.isPending}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void handleAsk();
                }}
              />
              {askMutation.isPending ? (
                <Button type="danger" icon={<Square size={14} />} onClick={() => abortRef.current?.abort()}>
                  取消
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<Send size={14} />}
                  disabled={!question.trim() || !hasPermission('report:chatbi:ask')}
                  onClick={() => void handleAsk()}
                >
                  发送
                </Button>
              )}
            </Space>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="page-container chatbi-page">
      <MasterDetailLayout
        master={master}
        detail={<div className="chatbi-detail">{detailContent}</div>}
        defaultSize={300}
        minSize={240}
        maxSize={420}
        persistKey="report-chatbi"
        responsiveBreakpoint={720}
        showDetail={Boolean(activeSessionId)}
        onBack={() => setActiveSessionId(undefined)}
      />

      <AppModal
        title="新建智能问数会话"
        visible={createVisible}
        width={560}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={createMutation.isPending}
      >
        <Form labelPosition="left" labelWidth={90} getFormApi={(api) => { createFormApi.current = api; }}>
          <Form.Input field="title" label="会话名称" rules={[{ required: true, message: '请输入会话名称' }]} maxLength={128} />
          <Form.Slot label="上下文类型">
            <RadioGroup type="button" value={contextType} onChange={(event) => setContextType(event.target.value as typeof contextType)}>
              <Radio value="dataset">治理数据集</Radio>
              <Radio value="datasource">数据源</Radio>
            </RadioGroup>
          </Form.Slot>
          <Form.Select
            field="contextId"
            label={contextType === 'dataset' ? '数据集' : '数据源'}
            style={{ width: '100%' }}
            rules={[{ required: true, message: '请选择数据上下文' }]}
            filter
            optionList={(contextType === 'dataset' ? datasetQuery.data : datasourceQuery.data)?.map((item) => ({
              value: item.id,
              label: item.name,
            })) ?? []}
          />
          <Banner
            type="info"
            closeIcon={null}
            description="创建后会冻结可访问的表结构与权限边界；对话不会暴露模型密钥或内部安全规则。"
          />
        </Form>
      </AppModal>

      <AppModal
        title="重命名会话"
        visible={Boolean(renameTarget)}
        width={480}
        onCancel={() => setRenameTarget(null)}
        onOk={() => void handleRename()}
        confirmLoading={updateMutation.isPending}
      >
        <Form
          key={renameTarget?.id}
          labelPosition="left"
          labelWidth={72}
          initValues={{ title: renameTarget?.title }}
          getFormApi={(api) => { renameFormApi.current = api; }}
        >
          <Form.Input field="title" label="名称" rules={[{ required: true, message: '请输入会话名称' }]} maxLength={128} />
        </Form>
      </AppModal>

      <AppModal
        title="保存为治理资源"
        visible={Boolean(saveTarget)}
        width={560}
        onCancel={() => {
          setSaveTarget(null);
          setTargetDashboardId(undefined);
          setSaveResourceType('dataset');
          setSaveMode('new');
        }}
        onOk={() => void handleSaveResource()}
        confirmLoading={saveMutation.isPending}
      >
        <Form
          key={saveTarget?.id}
          labelPosition="left"
          labelWidth={100}
          initValues={{ resourceType: 'dataset', saveMode: 'new', targetDashboardId: undefined }}
          getFormApi={(api) => { saveFormApi.current = api; }}
          onValueChange={(values) => {
            const id = values.targetDashboardId ? Number(values.targetDashboardId) : undefined;
            setTargetDashboardId(id);
          }}
        >
          <Form.RadioGroup
            field="resourceType"
            label="资源类型"
            type="button"
            onChange={(event) => setSaveResourceType(event.target.value as 'dataset' | 'dashboard')}
          >
            <Radio value="dataset">数据集</Radio>
            <Radio value="dashboard">仪表盘</Radio>
          </Form.RadioGroup>
          {saveResourceType === 'dashboard' ? (
            <>
              <Form.RadioGroup
                field="saveMode"
                label="保存方式"
                type="button"
                onChange={(event) => setSaveMode(event.target.value as 'new' | 'existing')}
              >
                <Radio value="new">新建仪表盘</Radio>
                <Radio value="existing">添加到现有仪表盘</Radio>
              </Form.RadioGroup>
              {saveMode === 'existing' ? (
                <Form.Select
                  field="targetDashboardId"
                  label="目标仪表盘"
                  style={{ width: '100%' }}
                  rules={[{ required: true, message: '请选择目标仪表盘' }]}
                  filter
                  optionList={(dashboardLookupQuery.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
                />
              ) : (
                <Form.Input field="name" label="仪表盘名称" rules={[{ required: true, message: '请输入仪表盘名称' }]} />
              )}
            </>
          ) : (
            <Form.Input field="name" label="数据集名称" rules={[{ required: true, message: '请输入数据集名称' }]} />
          )}
        </Form>
      </AppModal>
    </div>
  );
}
