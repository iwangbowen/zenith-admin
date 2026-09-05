import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Empty,
  Form,
  Input,
  Rating,
  Select,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { RefreshCw, Settings, Send, UserCheck, ArrowRightLeft, XCircle, MessageSquare, Star } from 'lucide-react';
import type { MpKfSessionStatus, MpKfSessionEventType, MpKfSessionCloseReason, MpMessage, UpdateMpKfRoutingConfigInput } from '@zenith/shared/mp';
import type { WsMessage } from '@zenith/shared/platform';
import { usePermission } from '@/hooks/usePermission';
import { useWebSocket } from '@/hooks/useWebSocket';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import {
  mpKfSessionKeys,
  mpKfSessionStatsKeys,
  useAcceptMpKfSession,
  useCloseMpKfSession,
  useMpKfRoutingConfig,
  useMpKfSessionDetail,
  useMpKfSessionList,
  useMpKfSessionStats,
  useRateMpKfSession,
  useReplyMpKfSession,
  useSaveMpKfRoutingConfig,
  useTransferMpKfSession,
} from '@/hooks/queries/mp-kf';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { abortSubmit } from '@/lib/abort-submit';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { confirmDanger } from '@/utils/confirm';
const { Text } = Typography;

const STATUS_TAG: Record<MpKfSessionStatus, { label: string; color: 'orange' | 'green' | 'grey' }> = {
  waiting: { label: '排队中', color: 'orange' },
  active: { label: '进行中', color: 'green' },
  closed: { label: '已结束', color: 'grey' },
};
const STRATEGY_LABEL: Record<string, string> = { manual: '人工抢单', round_robin: '轮询分配', least_active: '负载最小' };
const EVENT_LABEL: Record<MpKfSessionEventType, string> = {
  create: '粉丝发起', assign: '自动分配', accept: '人工接入', transfer: '转接', reroute: '超时重路由', close: '结束',
};
const CLOSE_REASON_LABEL: Record<MpKfSessionCloseReason, string> = {
  manual: '手动结束', wait_timeout: '等待超时', idle_timeout: '空闲超时', system: '系统结束',
};

function msgPreview(m: Pick<MpMessage, 'msgType' | 'content'>): string {
  if (m.msgType === 'image') return '[图片]';
  if (m.msgType === 'voice') return '[语音]';
  if (m.msgType === 'video' || m.msgType === 'shortvideo') return '[视频]';
  if (m.msgType === 'location') return '[位置]';
  if (m.msgType === 'link') return '[链接]';
  if (m.msgType === 'event') return '[事件]';
  return m.content ?? '';
}

export default function MpKfSessionsPage() {
  const { hasPermission: can } = usePermission();
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const [tab, setTab] = useUrlTabState(['waiting', 'active', 'closed'] as const, 'waiting');
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  // 页面已用 ?tab= 承载页签态，选中会话不再入 URL（同页两个写 URL 的 hook 会竞写震荡，以 tab 为准）
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [pickModal, setPickModal] = useState<{ mode: 'accept' | 'transfer'; visible: boolean }>({ mode: 'accept', visible: false });
  const [pickKfId, setPickKfId] = useState<number | null>(null);
  const [pickRemark, setPickRemark] = useState('');
  const [configVisible, setConfigVisible] = useState(false);
  const configFormRef = useRef<FormApi>(null);
  const [rateVisible, setRateVisible] = useState(false);
  const [rateValue, setRateValue] = useState(5);
  const [rateRemark, setRateRemark] = useState('');

  const listQuery = useMpKfSessionList({ accountId: currentId ?? 0, status: tab, keyword: submittedKeyword || undefined, page: 1, pageSize: 50 }, !!currentId);
  const statsQuery = useMpKfSessionStats(currentId);
  const detailQuery = useMpKfSessionDetail(selectedId ?? undefined);
  const configQuery = useMpKfRoutingConfig(currentId, configVisible);
  const sessions = listQuery.data?.list ?? [];
  const stats = statsQuery.data ?? null;
  const detail = detailQuery.data ?? null;
  const config = configQuery.data ?? null;

  const rateMutation = useRateMpKfSession();
  const acceptMutation = useAcceptMpKfSession();
  const transferMutation = useTransferMpKfSession();
  const closeMutation = useCloseMpKfSession();
  const replyMutation = useReplyMpKfSession();
  const saveConfigMutation = useSaveMpKfRoutingConfig();

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: mpKfSessionKeys.lists });
    void queryClient.invalidateQueries({ queryKey: mpKfSessionStatsKeys.detail(currentId) });
    if (selectedId) void queryClient.invalidateQueries({ queryKey: mpKfSessionKeys.detail(selectedId) });
  }, [currentId, queryClient, selectedId]);

  useWebSocket(useCallback((msg: WsMessage) => {
    if (!msg.type.startsWith('mp-kf:')) return;
    const accountId = (msg.payload as { accountId?: number }).accountId;
    if (accountId !== currentId) return;
    refreshAll();
  }, [currentId, refreshAll]));

  const handleRate = async () => {
    if (!detail) return;
    await rateMutation.mutateAsync({ params: { id: detail.id }, body: { rating: rateValue, remark: rateRemark || undefined } });
    Toast.success('已记录评分');
    setRateVisible(false);
  };

  const selectSession = (id: number) => {
    setSelectedId(id);
  };

  const handleTabChange = (key: string) => {
    setTab(key as MpKfSessionStatus);
    setSelectedId(null);
  };

  const handleSearch = () => {
    setSubmittedKeyword(keyword);
    void queryClient.invalidateQueries({ queryKey: mpKfSessionKeys.lists });
  };
  const handleReset = () => {
    setKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: mpKfSessionKeys.lists });
  };

  const openPick = (mode: 'accept' | 'transfer') => {
    const agents = (stats?.agents ?? []).filter((a) => a.status === 'enabled' && (mode === 'accept' || a.kfId !== detail?.kfId));
    setPickKfId(agents[0]?.kfId ?? null);
    setPickRemark('');
    setPickModal({ mode, visible: true });
  };

  const handlePickConfirm = async () => {
    if (!detail || !pickKfId) { Toast.warning('请选择客服'); abortSubmit('validation'); }
    if (pickModal.mode === 'accept') {
      await acceptMutation.mutateAsync({ params: { id: detail.id }, body: { kfId: pickKfId } });
      Toast.success('已接入');
    } else {
      await transferMutation.mutateAsync({ params: { id: detail.id }, body: { toKfId: pickKfId, remark: pickRemark || undefined } });
      Toast.success('已转接');
    }
    setPickModal((p) => ({ ...p, visible: false }));
  };

  const handleClose = () => {
    if (!detail) return;
    confirmDanger({
      title: '结束会话', content: '确定结束当前会话吗？',
      onOk: async () => {
        await closeMutation.mutateAsync({ params: { id: detail.id }, body: {} });
        Toast.success('已结束');
      },
    });
  };

  const handleSend = async () => {
    if (!detail || !replyText.trim()) return;
    await replyMutation.mutateAsync({ params: { id: detail.id }, body: { msgType: 'text', content: replyText.trim() } });
    setReplyText('');
  };

  const openConfig = () => {
    if (!currentId) return;
    setConfigVisible(true);
  };

  const handleSaveConfig = async () => {
    if (!currentId) return;
    let values: UpdateMpKfRoutingConfigInput;
    try { values = (await configFormRef.current?.validate())!; } catch { abortSubmit('validation'); }
    await saveConfigMutation.mutateAsync({ query: { accountId: currentId }, body: values });
    Toast.success('已保存');
    setConfigVisible(false);
  };

  const agentOptions = (stats?.agents ?? []).filter((a) => a.status === 'enabled' && (pickModal.mode === 'accept' || a.kfId !== detail?.kfId));
  const acting = acceptMutation.isPending || transferMutation.isPending;

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );
  const renderKeywordInput = () => (
    <KeywordInput placeholder="搜索 openid / 粉丝昵称" value={keyword} onChange={setKeyword} onSearch={handleSearch} width={200} />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );
  const renderSessionActions = () => {
    const configButton = can('mp:kf:session:config') ? (
      <Button icon={<Settings size={14} />} disabled={!currentId} onClick={openConfig}>路由配置</Button>
    ) : null;
    return (
      <>
        <Button icon={<RefreshCw size={14} />} onClick={refreshAll}>刷新</Button>
        {configButton}
      </>
    );
  };

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderAccountFilter()}
            {renderKeywordInput()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderSessionActions()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordInput()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={renderAccountFilter()}
        mobileActions={renderSessionActions()}
        filterTitle="会话筛选"
        actionTitle="会话操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      {stats && (
        <>
          <StatGrid minItemWidth={150} style={{ marginBottom: 12 }}>
            <StatCard title="排队待接入" value={stats.waiting} accent="#fa8c16" />
            <StatCard title="进行中" value={stats.active} accent="#52c41a" />
            <StatCard title="今日已结束" value={stats.closedToday} accent="#8c8c8c" />
            <StatCard title="今日平均等待(秒)" value={stats.avgWaitSeconds} accent="#1677ff" />
            <StatCard title="今日满意度" value={stats.avgRating} accent="#eb2f96" />
          </StatGrid>
          <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Text type="tertiary" size="small">客服负载：</Text>
            {stats.agents.length === 0 && <Text type="tertiary" size="small">暂无客服</Text>}
            {stats.agents.map((a) => (
              <Tag key={a.kfId} color={a.status === 'enabled' ? 'blue' : 'grey'} type="light">
                {a.nickname}：{a.activeCount}
              </Tag>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', height: 'calc(100dvh - 280px)', minHeight: 420 }}>
        <MasterDetailLayout
          bordered
          gap={12}
          defaultSize={340}
          minSize={260}
          maxSize={480}
          persistKey="mpKfSessions"
          showDetail={selectedId != null}
          onBack={() => setSelectedId(null)}
          master={(
            <>
              <MasterDetailLayout.Header style={{ padding: '0 8px' }}>
                <Tabs collapsible="auto" type="line" activeKey={tab} onChange={handleTabChange} style={{ flex: 1, minWidth: 0 }}>
                  <TabPane tab="待接入" itemKey="waiting" />
                  <TabPane tab="进行中" itemKey="active" />
                  <TabPane tab="已结束" itemKey="closed" />
                </Tabs>
              </MasterDetailLayout.Header>
              <MasterDetailLayout.Body>
                <Spin spinning={listQuery.isFetching}>
                  {sessions.length === 0 ? (
                    <Empty description="暂无会话" style={{ padding: 32 }} />
                  ) : sessions.map((s) => (
                    <div key={s.id} onClick={() => selectSession(s.id)}
                      style={{
                        display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer',
                        borderBottom: '1px solid var(--semi-color-fill-0)',
                        background: selectedId === s.id ? 'var(--semi-color-primary-light-default)' : 'transparent',
                      }}>
                      <Badge count={s.unreadCount} overflowCount={99} type="danger">
                        <Avatar size="small" src={s.fanAvatar ?? undefined} color="light-blue">{(s.fanNickname ?? s.openid).slice(0, 1)}</Avatar>
                      </Badge>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150, fontWeight: 500 }}>{s.fanNickname || s.openid}</Text>
                          <Tag size="small" color={STATUS_TAG[s.status].color} type="light">{STATUS_TAG[s.status].label}</Tag>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                          <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>
                            {s.kfNickname ? `客服：${s.kfNickname}` : '等待分配'}
                          </Text>
                          <Text type="tertiary" size="small">
                            {s.status === 'waiting' && s.waitSeconds != null ? `已等待 ${s.waitSeconds}s` : (s.lastMsgAt?.slice(11, 16) ?? '')}
                          </Text>
                        </div>
                      </div>
                    </div>
                  ))}
                </Spin>
              </MasterDetailLayout.Body>
            </>
          )}
          detail={!detail ? (
            <Empty image={<MessageSquare size={48} color="var(--semi-color-text-2)" />} description="请选择左侧会话" style={{ margin: 'auto' }} />
          ) : (
            <>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
                <Avatar size="small" src={detail.fanAvatar ?? undefined} color="light-blue">{(detail.fanNickname ?? detail.openid).slice(0, 1)}</Avatar>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space spacing={6}>
                    <Text strong>{detail.fanNickname || detail.openid}</Text>
                    <Tag size="small" color={STATUS_TAG[detail.status].color} type="light">{STATUS_TAG[detail.status].label}</Tag>
                    {detail.closeReason && <Tag size="small" color="grey" type="light">{CLOSE_REASON_LABEL[detail.closeReason]}</Tag>}
                  </Space>
                  <div><Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{detail.kfNickname ? `承接客服：${detail.kfNickname}` : '未分配'} · {detail.openid}</Text></div>
                </div>
                <Space>
                  {detail.status === 'waiting' && can('mp:kf:session:accept') && (
                    <Button size="small" type="primary" icon={<UserCheck size={14} />} onClick={() => openPick('accept')}>接入</Button>
                  )}
                  {detail.status === 'active' && can('mp:kf:session:transfer') && (
                    <Button size="small" icon={<ArrowRightLeft size={14} />} onClick={() => openPick('transfer')}>转接</Button>
                  )}
                  {detail.status !== 'closed' && can('mp:kf:session:close') && (
                    <Button size="small" type="danger" icon={<XCircle size={14} />} onClick={handleClose}>结束</Button>
                  )}
                  {detail.status === 'closed' && can('mp:kf:session:close') && (
                    <Button size="small" icon={<Star size={14} />} onClick={() => { setRateValue(detail.rating ?? 5); setRateRemark(detail.ratingRemark ?? ''); setRateVisible(true); }}>
                      {detail.rating ? `评分 ${detail.rating}★` : '满意度评分'}
                    </Button>
                  )}
                </Space>
              </div>

              <Spin spinning={detailQuery.isFetching} wrapperClassName="kf-detail-spin" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {detail.messages.length === 0 && <Empty description="暂无消息" style={{ margin: 'auto' }} />}
                    {detail.messages.map((m) => {
                      const out = m.direction === 'out';
                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '70%' }}>
                            <div style={{
                              background: out ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-0)',
                              color: out ? '#fff' : 'var(--semi-color-text-0)',
                              padding: '8px 12px', borderRadius: 'var(--semi-border-radius-medium)', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                            }}>{msgPreview(m)}</div>
                            <Text type="tertiary" size="small" style={{ display: 'block', textAlign: out ? 'right' : 'left', marginTop: 2 }}>{m.createdAt?.slice(5, 16)}</Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {detail.events.length > 0 && (
                    <div style={{ borderTop: '1px dashed var(--semi-color-border)', padding: '6px 16px', maxHeight: 84, overflowY: 'auto', background: 'var(--semi-color-fill-0)' }}>
                      {detail.events.map((e) => (
                        <Text key={e.id} type="tertiary" size="small" style={{ display: 'block' }}>
                          {e.createdAt?.slice(5, 16)} · {EVENT_LABEL[e.type]}
                          {e.toKfNickname ? ` → ${e.toKfNickname}` : ''}{e.operatorName ? `（${e.operatorName}）` : ''}{e.detail ? ` · ${e.detail}` : ''}
                        </Text>
                      ))}
                    </div>
                  )}

                  {detail.status === 'active' && can('mp:kf:session:reply') && (
                    <div style={{ borderTop: '1px solid var(--semi-color-border)', padding: 12, display: 'flex', gap: 8 }}>
                      <Input value={replyText} onChange={setReplyText} placeholder="输入回复内容，回车发送"
                        onEnterPress={() => void handleSend()} disabled={replyMutation.isPending} />
                      <Button type="primary" theme="solid" icon={<Send size={14} />} loading={replyMutation.isPending}
                        disabled={!replyText.trim()} onClick={() => void handleSend()}>发送</Button>
                    </div>
                  )}
                </div>
              </Spin>
            </>
          )}
        />
      </div>

      <AppModal title={pickModal.mode === 'accept' ? '接入会话' : '转接会话'} visible={pickModal.visible}
        onOk={handlePickConfirm} onCancel={() => setPickModal((p) => ({ ...p, visible: false }))} confirmLoading={acting} width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text type="tertiary" size="small">选择客服</Text>
            <Select style={{ width: '100%', marginTop: 4 }} value={pickKfId ?? undefined} onChange={(v) => setPickKfId(v as number)}
              placeholder="请选择客服" optionList={agentOptions.map((a) => ({ label: `${a.nickname}（进行中 ${a.activeCount}）`, value: a.kfId }))} />
          </div>
          {pickModal.mode === 'transfer' && (
            <div>
              <Text type="tertiary" size="small">转接备注（可选）</Text>
              <Input style={{ marginTop: 4 }} value={pickRemark} onChange={setPickRemark} placeholder="如：客户咨询售后，转专员" maxLength={100} />
            </div>
          )}
          {agentOptions.length === 0 && <Banner type="warning" fullMode={false} description="无可用客服，请先在「多客服」中添加并启用客服账号。" />}
        </div>
      </AppModal>

      <AppModal title="多客服路由治理配置" visible={configVisible}
        onOk={handleSaveConfig} onCancel={() => setConfigVisible(false)} confirmLoading={saveConfigMutation.isPending} width={520}>
        {config && (
          <Form key={config.id} getFormApi={(api) => { (configFormRef as { current: FormApi }).current = api; }}
            labelPosition="left" labelWidth={140}
            initValues={{
              enabled: config.enabled, strategy: config.strategy, maxConcurrent: config.maxConcurrent,
              waitTimeoutMinutes: config.waitTimeoutMinutes, idleTimeoutMinutes: config.idleTimeoutMinutes,
              autoCloseEnabled: config.autoCloseEnabled, welcomeText: config.welcomeText ?? '',
            }}>
            <Form.Switch field="enabled" label="启用会话治理" />
            <Form.Select field="strategy" label="分配策略" style={{ width: '100%' }}
              optionList={Object.entries(STRATEGY_LABEL).map(([value, label]) => ({ label, value }))} />
            <Form.InputNumber field="maxConcurrent" label="单客服最大并发" min={1} max={100} style={{ width: '100%' }} />
            <Form.InputNumber field="waitTimeoutMinutes" label="排队超时(分钟)" min={1} max={1440} style={{ width: '100%' }} />
            <Form.InputNumber field="idleTimeoutMinutes" label="空闲超时(分钟)" min={1} max={1440} style={{ width: '100%' }} />
            <Form.Switch field="autoCloseEnabled" label="空闲自动结束" />
            <Form.TextArea field="welcomeText" label="接入欢迎语" maxCount={500} maxLength={500} autosize rows={2} placeholder="客服接入后自动发送（留空则不发送）" />
          </Form>
        )}
      </AppModal>

      <AppModal title="会话满意度评分" visible={rateVisible} confirmLoading={rateMutation.isPending}
        onOk={() => void handleRate()} onCancel={() => setRateVisible(false)} width={400}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: '8px 0' }}>
          <Rating value={rateValue} onChange={setRateValue} size={28} />
          <Input value={rateRemark} onChange={setRateRemark} placeholder="评价备注（可选）" maxLength={255} style={{ width: '100%' }} />
        </div>
      </AppModal>
    </div>
  );
}
