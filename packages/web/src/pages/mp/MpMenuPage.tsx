import { useEffect, useState, useCallback } from 'react';
import { Button, Input, Select, Space, Spin, Tag, Toast, Modal, Banner, Empty, Typography } from '@douyinfe/semi-ui';
import { RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import type { MpMenu, MpMenuButton } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const TYPE_OPTIONS = [
  { label: '网页链接 (view)', value: 'view' },
  { label: '点击事件 (click)', value: 'click' },
  { label: '小程序 (miniprogram)', value: 'miniprogram' },
];

type Sel = { l1: number; l2: number | null } | null;

const clone = (b: MpMenuButton[]): MpMenuButton[] => JSON.parse(JSON.stringify(b));

export default function MpMenuPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [menu, setMenu] = useState<MpMenu | null>(null);
  const [buttons, setButtons] = useState<MpMenuButton[]>([]);
  const [selected, setSelected] = useState<Sel>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'pull' | 'delete'>('');

  const load = useCallback(async (accountId: number) => {
    setLoading(true);
    try {
      const res = await request.get<MpMenu>(`/api/mp/menu?accountId=${accountId}`);
      setMenu(res.data ?? null);
      setButtons(res.data?.buttons ?? []);
      setSelected(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (currentId) void load(currentId); else { setButtons([]); setMenu(null); } }, [currentId, load]);

  const getSelectedBtn = (): MpMenuButton | null => {
    if (!selected) return null;
    const b = buttons[selected.l1];
    if (!b) return null;
    return selected.l2 == null ? b : (b.sub_button?.[selected.l2] ?? null);
  };

  const mutateSelected = (fn: (b: MpMenuButton) => void) => {
    if (!selected) return;
    const next = clone(buttons);
    const target = selected.l2 == null ? next[selected.l1] : next[selected.l1].sub_button![selected.l2];
    fn(target);
    setButtons(next);
  };

  const addFirstLevel = () => {
    if (buttons.length >= 3) { Toast.warning('一级菜单最多 3 个'); return; }
    const next = [...clone(buttons), { name: '新菜单' }];
    setButtons(next);
    setSelected({ l1: next.length - 1, l2: null });
  };

  const addSub = (l1: number) => {
    const next = clone(buttons);
    const parent = next[l1];
    parent.sub_button = parent.sub_button ?? [];
    if (parent.sub_button.length >= 5) { Toast.warning('二级菜单最多 5 个'); return; }
    // 父按钮变为容器：清除其动作字段
    delete parent.type; delete parent.key; delete parent.url; delete parent.appid; delete parent.pagepath;
    parent.sub_button.push({ name: '子菜单', type: 'view', url: '' });
    setButtons(next);
    setSelected({ l1, l2: parent.sub_button.length - 1 });
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = clone(buttons);
    if (selected.l2 == null) {
      next.splice(selected.l1, 1);
    } else {
      next[selected.l1].sub_button!.splice(selected.l2, 1);
      if (next[selected.l1].sub_button!.length === 0) delete next[selected.l1].sub_button;
    }
    setButtons(next);
    setSelected(null);
  };

  const setType = (type: string) => {
    mutateSelected((b) => {
      b.type = type;
      delete b.key; delete b.url; delete b.appid; delete b.pagepath;
      if (type === 'view') b.url = '';
      else if (type === 'click') b.key = '';
      else if (type === 'miniprogram') { b.appid = ''; b.pagepath = ''; b.url = ''; }
    });
  };

  const doSave = async () => {
    if (!currentId) return;
    setBusy('save');
    try {
      const res = await request.post<MpMenu>('/api/mp/menu/save', { accountId: currentId, buttons });
      if (res.code === 0) { Toast.success('已保存草稿'); setMenu(res.data ?? null); }
    } finally { setBusy(''); }
  };

  const doPublish = async () => {
    if (!currentId) return;
    setBusy('publish');
    try {
      const res = await request.post<MpMenu>('/api/mp/menu/publish', { accountId: currentId });
      if (res.code === 0) { Toast.success('已发布到微信'); setMenu(res.data ?? null); }
    } finally { setBusy(''); }
  };

  const doPull = async () => {
    if (!currentId) return;
    setBusy('pull');
    try {
      const res = await request.post<MpMenu>('/api/mp/menu/pull', { accountId: currentId });
      if (res.code === 0) { Toast.success('已从微信拉取'); setMenu(res.data ?? null); setButtons(res.data?.buttons ?? []); setSelected(null); }
    } finally { setBusy(''); }
  };

  const doDelete = () => {
    if (!currentId) return;
    Modal.confirm({
      title: '确定要删除微信端的自定义菜单吗？',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        setBusy('delete');
        try {
          const res = await request.post<MpMenu>('/api/mp/menu/delete', { accountId: currentId });
          if (res.code === 0) { Toast.success('已删除微信菜单'); setMenu(res.data ?? null); setButtons([]); setSelected(null); }
        } finally { setBusy(''); }
      },
    });
  };

  const sel = getSelectedBtn();
  const selIsContainer = selected?.l2 == null && !!buttons[selected?.l1 ?? -1]?.sub_button?.length;

  return (
    <div className="page-container">
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        {menu && (menu.status === 'published'
          ? <Tag color="green" type="light">已发布{menu.publishedAt ? ` · ${menu.publishedAt.slice(5, 16)}` : ''}</Tag>
          : <Tag color="grey" type="light">草稿</Tag>)}
        {can('mp:menu:pull') && <Button icon={<RefreshCw size={14} />} loading={busy === 'pull'} disabled={!currentId} onClick={() => void doPull()}>拉取</Button>}
        {can('mp:menu:save') && <Button type="primary" icon={<Save size={14} />} loading={busy === 'save'} disabled={!currentId} onClick={() => void doSave()}>保存草稿</Button>}
        {can('mp:menu:publish') && <Button type="primary" theme="solid" icon={<Send size={14} />} loading={busy === 'publish'} disabled={!currentId} onClick={() => void doPublish()}>发布到微信</Button>}
        {can('mp:menu:delete') && <Button type="danger" icon={<Trash2 size={14} />} loading={busy === 'delete'} disabled={!currentId} onClick={doDelete}>删除菜单</Button>}
      </Space>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Spin spinning={loading}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {/* 菜单结构预览 */}
          <div style={{ flex: 1, border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, minHeight: 280, background: 'var(--semi-color-bg-1)' }}>
            <Typography.Text type="tertiary" style={{ fontSize: 12 }}>菜单结构（一级最多 3 个，二级最多 5 个）</Typography.Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'flex-end' }}>
              {buttons.map((b, l1) => (
                <div key={l1} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(b.sub_button ?? []).map((sb, l2) => (
                    <MenuCell key={l2} label={sb.name} active={selected?.l1 === l1 && selected?.l2 === l2} onClick={() => setSelected({ l1, l2 })} />
                  ))}
                  {(b.sub_button?.length ?? 0) < 5 && (
                    <MenuCell label="+ 子菜单" dashed onClick={() => addSub(l1)} />
                  )}
                  <MenuCell label={b.name} primary active={selected?.l1 === l1 && selected?.l2 == null} onClick={() => setSelected({ l1, l2: null })} />
                </div>
              ))}
              {buttons.length < 3 && (
                <div style={{ flex: 1 }}>
                  <MenuCell label="+ 添加菜单" dashed primary onClick={addFirstLevel} />
                </div>
              )}
            </div>
          </div>

          {/* 编辑面板 */}
          <div style={{ width: 320, flexShrink: 0, border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, minHeight: 280, background: 'var(--semi-color-bg-1)' }}>
            {!sel ? (
              <Empty description="点击左侧菜单按钮进行编辑" style={{ paddingTop: 60 }} />
            ) : (
              <Space vertical align="start" style={{ width: '100%' }} spacing="loose">
                <Field label="按钮名称">
                  <Input value={sel.name} maxLength={selected?.l2 == null ? 16 : 60} onChange={(v) => mutateSelected((b) => { b.name = v; })} />
                </Field>
                {selIsContainer ? (
                  <Typography.Text type="tertiary" style={{ fontSize: 12 }}>该一级菜单含子菜单，作为容器仅需名称。删除全部子菜单后可设置动作。</Typography.Text>
                ) : (
                  <>
                    <Field label="动作类型">
                      <Select style={{ width: '100%' }} optionList={TYPE_OPTIONS} value={sel.type ?? 'view'} onChange={(v) => setType(v as string)} />
                    </Field>
                    {(sel.type ?? 'view') === 'view' && (
                      <Field label="网页地址"><Input value={sel.url ?? ''} placeholder="https://" onChange={(v) => mutateSelected((b) => { b.url = v; })} /></Field>
                    )}
                    {sel.type === 'click' && (
                      <Field label="事件 KEY"><Input value={sel.key ?? ''} placeholder="自定义 key" onChange={(v) => mutateSelected((b) => { b.key = v; })} /></Field>
                    )}
                    {sel.type === 'miniprogram' && (
                      <>
                        <Field label="小程序 AppID"><Input value={sel.appid ?? ''} onChange={(v) => mutateSelected((b) => { b.appid = v; })} /></Field>
                        <Field label="页面路径"><Input value={sel.pagepath ?? ''} placeholder="pages/index" onChange={(v) => mutateSelected((b) => { b.pagepath = v; })} /></Field>
                        <Field label="兼容网页"><Input value={sel.url ?? ''} placeholder="https://（低版本回退）" onChange={(v) => mutateSelected((b) => { b.url = v; })} /></Field>
                      </>
                    )}
                  </>
                )}
                <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} onClick={removeSelected}>删除此按钮</Button>
              </Space>
            )}
          </div>
        </div>
      </Spin>
    </div>
  );
}

function MenuCell({ label, active, primary, dashed, onClick }: { label: string; active?: boolean; primary?: boolean; dashed?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: '100%', padding: '10px 8px', fontSize: 13, cursor: 'pointer',
      border: `1px ${dashed ? 'dashed' : 'solid'} ${active ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'}`,
      borderRadius: 6,
      background: active ? 'var(--semi-color-primary-light-default)' : (primary ? 'var(--semi-color-fill-0)' : 'var(--semi-color-bg-2)'),
      color: active ? 'var(--semi-color-primary)' : (dashed ? 'var(--semi-color-text-2)' : 'var(--semi-color-text-0)'),
      fontWeight: primary ? 600 : 400, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>{label}</button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
