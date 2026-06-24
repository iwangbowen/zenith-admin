import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Button, Form, Input, Modal, Space, Tag, Toast, Banner, Typography, Empty, Select, Divider,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Plus, RotateCcw, Trash2, FlaskConical } from 'lucide-react';
import type { MpConditionalMenu, MpMenuButton, MpMenuMatchRule } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const { Text } = Typography;

const SEX_OPTIONS = [{ label: '不限', value: '' }, { label: '男', value: '1' }, { label: '女', value: '2' }];
const PLATFORM_OPTIONS = [{ label: '不限', value: '' }, { label: 'iOS', value: '1' }, { label: 'Android', value: '2' }, { label: 'PC', value: '3' }];
const BTN_TYPES = [
  { label: '跳转网页(view)', value: 'view' },
  { label: '点击事件(click)', value: 'click' },
  { label: '小程序(miniprogram)', value: 'miniprogram' },
  { label: '扫码(scancode_waitmsg)', value: 'scancode_waitmsg' },
  { label: '父级菜单(无动作)', value: '' },
];

function ruleSummary(r: MpMenuMatchRule): string {
  const parts: string[] = [];
  if (r.tagId) parts.push(`标签#${r.tagId}`);
  if (r.sex) parts.push(r.sex === '1' ? '男' : '女');
  if (r.clientPlatformType) parts.push(['', 'iOS', 'Android', 'PC'][Number(r.clientPlatformType)] ?? '');
  const region = [r.country, r.province, r.city].filter(Boolean).join('/');
  if (region) parts.push(region);
  if (r.language) parts.push(r.language);
  return parts.length ? parts.join(' · ') : '全部用户';
}

interface EditableButton extends MpMenuButton { sub_button?: EditableButton[] }

/** 极简两级按钮编辑器（微信菜单固定两级） */
function ButtonEditor({ value, onChange }: { value: EditableButton[]; onChange: (v: EditableButton[]) => void }) {
  const update = (idx: number, patch: Partial<EditableButton>) => {
    const next = value.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange(next);
  };
  const updateSub = (i: number, j: number, patch: Partial<EditableButton>) => {
    const next = value.map((b, bi) => (bi === i ? { ...b, sub_button: (b.sub_button ?? []).map((s, si) => (si === j ? { ...s, ...patch } : s)) } : b));
    onChange(next);
  };
  const valueField = (b: EditableButton, set: (p: Partial<EditableButton>) => void) => {
    if (b.type === 'view') return <Input size="small" placeholder="网页 URL" value={b.url} onChange={(v) => set({ url: v })} />;
    if (b.type === 'miniprogram') return <Input size="small" placeholder="小程序 pagepath" value={b.pagepath} onChange={(v) => set({ pagepath: v })} />;
    if (b.type && b.type !== '') return <Input size="small" placeholder="事件 key" value={b.key} onChange={(v) => set({ key: v })} />;
    return null;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((b, i) => (
        <div key={i} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 8 }}>
          <Space wrap align="center">
            <Input size="small" style={{ width: 130 }} placeholder="一级菜单名" value={b.name} onChange={(v) => update(i, { name: v })} />
            <Select size="small" style={{ width: 160 }} value={b.type ?? ''} optionList={BTN_TYPES} onChange={(v) => update(i, { type: v as string })} />
            <div style={{ width: 200 }}>{valueField(b, (p) => update(i, p))}</div>
            <Button size="small" theme="borderless" type="tertiary" onClick={() => update(i, { sub_button: [...(b.sub_button ?? []), { name: '子菜单', type: 'view', url: '' }] })} disabled={(b.sub_button?.length ?? 0) >= 5}>+子菜单</Button>
            <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={12} />} onClick={() => onChange(value.filter((_, x) => x !== i))} />
          </Space>
          {(b.sub_button ?? []).map((s, j) => (
            <Space wrap align="center" key={j} style={{ marginTop: 6, marginLeft: 20 }}>
              <Input size="small" style={{ width: 120 }} placeholder="子菜单名" value={s.name} onChange={(v) => updateSub(i, j, { name: v })} />
              <Select size="small" style={{ width: 160 }} value={s.type ?? 'view'} optionList={BTN_TYPES.filter((t) => t.value !== '')} onChange={(v) => updateSub(i, j, { type: v as string })} />
              <div style={{ width: 200 }}>{valueField(s, (p) => updateSub(i, j, p))}</div>
              <Button size="small" theme="borderless" type="danger" icon={<Trash2 size={12} />} onClick={() => update(i, { sub_button: (b.sub_button ?? []).filter((_, x) => x !== j) })} />
            </Space>
          ))}
        </div>
      ))}
      {value.length < 3 && <Button size="small" icon={<Plus size={12} />} onClick={() => onChange([...value, { name: '菜单', type: 'view', url: '' }])}>添加一级菜单</Button>}
    </div>
  );
}

export default function MpConditionalMenusPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<MpConditionalMenu[]>([]);
  const { page, setPage, buildPagination } = usePagination();

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<MpConditionalMenu | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [buttons, setButtons] = useState<EditableButton[]>([]);
  const formRef = useRef<FormApi>(null);

  const [matchVisible, setMatchVisible] = useState(false);
  const [matchUserId, setMatchUserId] = useState('');
  const [matchResult, setMatchResult] = useState<MpMenuButton[] | null>(null);
  const [matching, setMatching] = useState(false);

  const fetchList = useCallback(async () => {
    if (!currentId) { setList([]); return; }
    const reqId = currentId;
    setLoading(true);
    try {
      const res = await request.get<MpConditionalMenu[]>(`/api/mp/conditional-menus?accountId=${currentId}`);
      if (currentIdRef.current !== reqId) return;
      setList(res.data ?? []);
    } finally {
      if (currentIdRef.current === reqId) setLoading(false);
    }
  }, [currentId, currentIdRef]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  const openCreate = () => { setEditing(null); setButtons([{ name: '菜单', type: 'view', url: '' }]); setModalVisible(true); };
  const openEdit = (r: MpConditionalMenu) => { setEditing(r); setButtons((r.buttons as EditableButton[]) ?? []); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: Record<string, unknown>;
    try { values = (await formRef.current?.validate())!; } catch { return; }
    if (!currentId) return;
    if (buttons.length === 0) { Toast.warning('请至少添加一个一级菜单'); return; }
    const matchRule: MpMenuMatchRule = {
      tagId: (values.tagId as string) || undefined,
      sex: (values.sex as string) || undefined,
      country: (values.country as string) || undefined,
      province: (values.province as string) || undefined,
      city: (values.city as string) || undefined,
      clientPlatformType: (values.clientPlatformType as string) || undefined,
      language: (values.language as string) || undefined,
    };
    if (!Object.values(matchRule).some(Boolean)) { Toast.warning('请至少设置一个匹配条件'); return; }
    setSubmitting(true);
    try {
      if (editing) {
        const res = await request.put(`/api/mp/conditional-menus/${editing.id}`, { name: values.name, buttons, matchRule });
        if (res.code !== 0) return;
        Toast.success('已保存');
      } else {
        const res = await request.post('/api/mp/conditional-menus', { accountId: currentId, name: values.name, buttons, matchRule });
        if (res.code !== 0) return;
        Toast.success('已创建');
      }
      setModalVisible(false);
      void fetchList();
    } finally { setSubmitting(false); }
  };

  const handlePublish = (r: MpConditionalMenu) => {
    Modal.confirm({
      title: `发布「${r.name}」？`, content: '将向微信下发该个性化菜单。',
      onOk: async () => { const res = await request.post(`/api/mp/conditional-menus/${r.id}/publish`, {}); if (res.code === 0) { Toast.success('已发布'); void fetchList(); } },
    });
  };

  const handleDelete = (r: MpConditionalMenu) => {
    Modal.confirm({
      title: `删除「${r.name}」？`, content: '将同时删除微信侧个性化菜单。', okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => { const res = await request.delete(`/api/mp/conditional-menus/${r.id}`); if (res.code === 0) { Toast.success('已删除'); void fetchList(); } },
    });
  };

  const handleTryMatch = async () => {
    if (!currentId || !matchUserId.trim()) { Toast.warning('请输入 openid 或微信号'); return; }
    setMatching(true);
    try {
      const res = await request.post<{ buttons: MpMenuButton[] }>(`/api/mp/conditional-menus/trymatch`, { accountId: currentId, userId: matchUserId.trim() });
      if (res.code === 0) setMatchResult(res.data?.buttons ?? []);
    } finally { setMatching(false); }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '匹配规则', dataIndex: 'matchRule', width: 240, render: (r: MpMenuMatchRule) => <Text type="tertiary">{ruleSummary(r)}</Text> },
    { title: '一级按钮数', dataIndex: 'buttons', width: 100, render: (b: MpMenuButton[]) => (b?.length ?? 0) },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const, render: (s: string) => <Tag color={s === 'published' ? 'green' : 'grey'} type="light">{s === 'published' ? '已发布' : '草稿'}</Tag> },
    {
      title: '操作', key: 'actions', width: 180, fixed: 'right' as const,
      render: (_: unknown, r: MpConditionalMenu) => (
        <Space>
          {can('mp:condmenu:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {can('mp:condmenu:publish') && <Button theme="borderless" size="small" onClick={() => handlePublish(r)}>发布</Button>}
          {can('mp:condmenu:delete') && <Button theme="borderless" type="danger" size="small" onClick={() => handleDelete(r)}>删除</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => void fetchList()}>刷新</Button>
        <Button icon={<FlaskConical size={14} />} disabled={!currentId} onClick={() => { setMatchResult(null); setMatchUserId(''); setMatchVisible(true); }}>匹配测试</Button>
        {can('mp:condmenu:create') && <Button type="primary" icon={<Plus size={14} />} disabled={!currentId} onClick={openCreate}>新增个性化菜单</Button>}
      </SearchToolbar>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}
      <Banner type="info" fullMode={false} description="个性化菜单按匹配规则（标签/性别/地区/客户端/语言）向不同人群下发不同菜单；未命中任何个性化菜单的用户将看到默认自定义菜单。" style={{ marginBottom: 12 }} />

      <ConfigurableTable bordered loading={loading} onRefresh={() => void fetchList()} refreshLoading={loading}
        columns={columns} dataSource={list} rowKey="id" pagination={buildPagination(list.length, () => { setPage(page); })} scroll={{ x: 900 }} />

      <AppModal title={editing ? '编辑个性化菜单' : '新增个性化菜单'} visible={modalVisible}
        onOk={handleSubmit} onCancel={() => setModalVisible(false)} confirmLoading={submitting} width={680}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { (formRef as { current: FormApi }).current = api; }}
          labelPosition="left" labelWidth={110}
          initValues={editing ? { name: editing.name, ...editing.matchRule } : { name: '' }}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} placeholder="便于识别，如：女性用户菜单" />
          <Divider margin="8px" align="left"><Text type="tertiary" size="small">匹配规则（至少一项）</Text></Divider>
          <Form.Input field="tagId" label="标签ID" placeholder="微信标签 id（可在标签管理查看）" />
          <Form.Select field="sex" label="性别" optionList={SEX_OPTIONS} style={{ width: '100%' }} />
          <Form.Select field="clientPlatformType" label="客户端" optionList={PLATFORM_OPTIONS} style={{ width: '100%' }} />
          <Space>
            <Form.Input field="country" label="国家" labelWidth={50} placeholder="中国" />
            <Form.Input field="province" label="省" labelWidth={40} placeholder="广东" />
            <Form.Input field="city" label="市" labelWidth={40} placeholder="深圳" />
          </Space>
          <Form.Input field="language" label="语言" placeholder="zh_CN" />
          <Divider margin="8px" align="left"><Text type="tertiary" size="small">菜单按钮（最多 3 个一级，每个最多 5 个子菜单）</Text></Divider>
          <ButtonEditor value={buttons} onChange={setButtons} />
        </Form>
      </AppModal>

      <AppModal title="个性化菜单匹配测试" visible={matchVisible} onOk={() => void handleTryMatch()} okText="测试"
        confirmLoading={matching} onCancel={() => setMatchVisible(false)} width={480}>
        <Space style={{ width: '100%' }}>
          <Input value={matchUserId} onChange={setMatchUserId} placeholder="输入 openid 或微信号" style={{ width: 320 }} onEnterPress={() => void handleTryMatch()} />
        </Space>
        {matchResult && (
          <div style={{ marginTop: 12 }}>
            <Text type="tertiary" size="small">命中菜单按钮：</Text>
            {matchResult.length === 0 ? <Empty description="未命中个性化菜单（将使用默认菜单）" style={{ padding: 16 }} />
              : <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{matchResult.map((b, i) => (
                <li key={i}>{b.name}{b.sub_button?.length ? `（${b.sub_button.map((s) => s.name).join('、')}）` : ''}</li>
              ))}</ul>}
          </div>
        )}
      </AppModal>
    </div>
  );
}
