import { useEffect, useState, useCallback } from 'react';
import { Button, Input, Select, Space, Spin, Tag, Toast, Modal, Banner, Empty } from '@douyinfe/semi-ui';
import { RefreshCw, Save, Send, Trash2, Plus } from 'lucide-react';
import type { MpMenu, MpMenuButton } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const CONTENT_TYPE_OPTIONS = [
  { label: '跳转网址', value: 'view' },
  { label: '点击事件', value: 'click' },
  { label: '跳转小程序', value: 'miniprogram' },
];

type Sel = { l1: number; l2: number | null } | null;

const clone = (b: MpMenuButton[]): MpMenuButton[] => structuredClone(b);

export default function MpMenuPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [menu, setMenu] = useState<MpMenu | null>(null);
  const [buttons, setButtons] = useState<MpMenuButton[]>([]);
  const [selected, setSelected] = useState<Sel>(null);
  const [activeL1, setActiveL1] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'pull' | 'delete'>('');

  const load = useCallback(async (accountId: number) => {
    setLoading(true);
    try {
      const res = await request.get<MpMenu>(`/api/mp/menu?accountId=${accountId}`);
      setMenu(res.data ?? null);
      setButtons(res.data?.buttons ?? []);
      setSelected(null);
      setActiveL1(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (currentId) void load(currentId);
    else { setButtons([]); setMenu(null); setSelected(null); setActiveL1(null); }
  }, [currentId, load]);

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
    const l1 = next.length - 1;
    setSelected({ l1, l2: null });
    setActiveL1(null);
  };

  const addSub = (l1: number) => {
    const next = clone(buttons);
    const parent = next[l1];
    parent.sub_button = parent.sub_button ?? [];
    if (parent.sub_button.length >= 5) { Toast.warning('二级菜单最多 5 个'); return; }
    delete parent.type; delete parent.key; delete parent.url; delete parent.appid; delete parent.pagepath;
    parent.sub_button.push({ name: '子菜单', type: 'view', url: '' });
    setButtons(next);
    setSelected({ l1, l2: parent.sub_button.length - 1 });
    setActiveL1(l1);
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = clone(buttons);
    if (selected.l2 == null) {
      next.splice(selected.l1, 1);
      setActiveL1(null);
    } else {
      next[selected.l1].sub_button!.splice(selected.l2, 1);
      if (next[selected.l1].sub_button!.length === 0) {
        delete next[selected.l1].sub_button;
        setActiveL1(null);
      }
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
      if (res.code === 0) {
        Toast.success('已从微信拉取');
        setMenu(res.data ?? null);
        setButtons(res.data?.buttons ?? []);
        setSelected(null);
        setActiveL1(null);
      }
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
          if (res.code === 0) {
            Toast.success('已删除微信菜单');
            setMenu(res.data ?? null);
            setButtons([]);
            setSelected(null);
            setActiveL1(null);
          }
        } finally { setBusy(''); }
      },
    });
  };

  const doClear = () => {
    Modal.confirm({
      title: '确定要清空本地菜单配置吗？',
      content: '此操作仅清空编辑器内容，不影响微信端已发布的菜单。',
      onOk: () => { setButtons([]); setSelected(null); setActiveL1(null); },
    });
  };

  /** 点击底部 tab */
  const handleTabClick = (l1: number) => {
    const btn = buttons[l1];
    if (btn.sub_button?.length) {
      if (activeL1 === l1) {
        setActiveL1(null);
      } else {
        setActiveL1(l1);
        setSelected({ l1, l2: null });
      }
    } else {
      setActiveL1(null);
      setSelected({ l1, l2: null });
    }
  };

  const sel = getSelectedBtn();
  const selIsContainer = selected?.l2 == null && !!buttons[selected?.l1 ?? -1]?.sub_button?.length;
  const selIsTopLevelLeaf = selected?.l2 == null && !selIsContainer;
  const currentAccountName = accounts.find(a => a.id === currentId)?.name ?? '公众号名称';
  const activeSubs = activeL1 === null ? [] : (buttons[activeL1]?.sub_button ?? []);
  const actionBusy = busy === 'save' || busy === 'publish';

  return (
    <div className="page-container">
      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        {menu && (menu.status === 'published'
          ? <Tag color="green" type="light">已发布{menu.publishedAt ? ` · ${menu.publishedAt.slice(5, 16)}` : ''}</Tag>
          : <Tag color="grey" type="light">草稿</Tag>)}
        {can('mp:menu:pull') && (
          <Button icon={<RefreshCw size={14} />} loading={busy === 'pull'} disabled={!currentId} onClick={() => void doPull()}>从微信拉取</Button>
        )}
        {can('mp:menu:save') && (
          <Button icon={<Save size={14} />} loading={busy === 'save'} disabled={!currentId} onClick={() => void doSave()}>保存草稿</Button>
        )}
        {can('mp:menu:publish') && (
          <Button type="primary" icon={<Send size={14} />} loading={busy === 'publish'} disabled={!currentId} onClick={() => void doPublish()}>发布到微信</Button>
        )}
        {can('mp:menu:delete') && (
          <Button type="danger" icon={<Trash2 size={14} />} loading={busy === 'delete'} disabled={!currentId} onClick={doDelete}>删除微信菜单</Button>
        )}
      </Space>

      <Spin spinning={loading}>
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* ── 手机预览 ── */}
          <div style={{
            width: 300,
            flexShrink: 0,
            background: '#e2e2e2',
            borderRadius: 44,
            padding: '16px 10px 14px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.18), 0 0 0 2px #c8c8c8',
          }}>
            {/* 顶部装饰：摄像头 + 听筒 */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, background: '#b8b8b8', borderRadius: '50%' }} />
              <div style={{ width: 52, height: 6, background: '#b8b8b8', borderRadius: 3 }} />
              <div style={{ width: 8, height: 8, background: '#b8b8b8', borderRadius: '50%' }} />
            </div>

            {/* 屏幕 */}
            <div style={{
              borderRadius: 20,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: 492,
              background: '#ededed',
              border: '1px solid #c4c4c4',
            }}>
              {/* 状态栏 */}
              <div style={{
                background: '#ededed',
                padding: '5px 14px 4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10,
                color: '#666',
                borderBottom: '1px solid #d8d8d8',
              }}>
                <span>••••• WeChat ☆</span>
                <span style={{ fontWeight: 600, color: '#333' }}>1:21 AM</span>
                <span>100% ▮</span>
              </div>

              {/* 微信顶部导航 */}
              <div style={{
                background: '#ededed',
                borderBottom: '1px solid #d4d4d4',
                padding: '9px 12px',
                display: 'flex',
                alignItems: 'center',
              }}>
                <span style={{ color: '#576B95', fontSize: 13 }}>‹ 返回</span>
                <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600, color: '#191919' }}>
                  {currentAccountName}
                </span>
                <span style={{ color: '#576B95', fontSize: 16 }}>⊙</span>
              </div>

              {/* 聊天内容区（含子菜单弹出层） */}
              <div style={{ flex: 1, background: '#ededed', position: 'relative', overflow: 'hidden' }}>
                {activeL1 !== null && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ background: '#f5f5f5', borderTop: '1px solid #d4d4d4', maxHeight: 280, overflowY: 'auto' }}>
                      {activeSubs.map((sub) => {
                        const subL2 = buttons[activeL1]?.sub_button?.indexOf(sub) ?? -1;
                        const isActive = selected?.l1 === activeL1 && selected?.l2 === subL2;
                        return (
                          <button
                            key={sub.name}
                            type="button"
                            onClick={() => { if (subL2 >= 0) setSelected({ l1: activeL1, l2: subL2 }); }}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              padding: '11px 16px',
                              fontSize: 13,
                              cursor: 'pointer',
                              borderTop: 'none',
                              borderRight: 'none',
                              borderBottom: '1px solid #ebebeb',
                              borderLeft: `3px solid ${isActive ? '#07c160' : 'transparent'}`,
                              background: isActive ? '#e8f7e8' : '#fff',
                              color: isActive ? '#07c160' : '#191919',
                              fontWeight: isActive ? 600 : 400,
                              fontFamily: 'inherit',
                              transition: 'background 0.12s',
                            }}
                          >
                            {sub.name}
                          </button>
                        );
                      })}
                      {activeSubs.length < 5 && (
                        <button
                          type="button"
                          onClick={() => addSub(activeL1)}
                          style={{
                            display: 'flex',
                            width: '100%',
                            alignItems: 'center',
                            padding: '10px 16px',
                            fontSize: 12,
                            cursor: 'pointer',
                            color: '#07c160',
                            background: '#f9f9f9',
                            border: 'none',
                            borderTop: activeSubs.length > 0 ? '1px dashed #ddd' : 'none',
                            gap: 4,
                            fontFamily: 'inherit',
                          }}
                        >
                          <Plus size={12} />
                          添加子菜单
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 底部菜单栏 */}
              <div style={{ background: '#f5f5f5', borderTop: '1px solid #d4d4d4', display: 'flex', minHeight: 48 }}>
                {buttons.map((btn, l1) => {
                  const isHighlighted = selected?.l1 === l1 || activeL1 === l1;
                  return (
                    <button
                      key={btn.name}
                      type="button"
                      onClick={() => handleTabClick(l1)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '10px 4px',
                        fontSize: 12,
                        cursor: 'pointer',
                        border: 'none',
                        borderRight: (l1 < buttons.length - 1 || buttons.length < 3) ? '1px solid #d4d4d4' : 'none',
                        background: isHighlighted ? 'rgba(7,193,96,0.07)' : 'transparent',
                        color: isHighlighted ? '#07c160' : '#191919',
                        fontWeight: isHighlighted ? 600 : 400,
                        minWidth: 0,
                        gap: 2,
                        fontFamily: 'inherit',
                        transition: 'background 0.12s',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 2px' }}>
                        {btn.name}
                      </span>
                      {btn.sub_button?.length ? (
                        <span style={{ fontSize: 8, opacity: 0.6, lineHeight: 1 }}>
                          {activeL1 === l1 ? '▾' : '▴'}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {buttons.length < 3 && (
                  <button
                    type="button"
                    onClick={addFirstLevel}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#aaa',
                      background: 'transparent',
                      border: 'none',
                      fontSize: 24,
                      fontWeight: 300,
                      minWidth: 40,
                      fontFamily: 'inherit',
                    }}
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '0 2px' }}>
              <button
                type="button"
                disabled={!currentId || actionBusy}
                onClick={() => void (can('mp:menu:publish') ? doPublish() : doSave())}
                style={{
                  flex: 1,
                  padding: '9px 4px',
                  background: (!currentId || actionBusy) ? '#b0b0b0' : '#07c160',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 20,
                  cursor: (!currentId || actionBusy) ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                {actionBusy ? '处理中…' : '保存并发布菜单'}
              </button>
              <button
                type="button"
                onClick={doClear}
                style={{
                  flex: 1,
                  padding: '9px 4px',
                  background: '#e64340',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                清空菜单
              </button>
            </div>
          </div>

          {/* ── 编辑面板 ── */}
          <div style={{ flex: 1, minWidth: 260, background: '#f2f2f2', borderRadius: 8, minHeight: 300 }}>
            {sel ? (
              <div style={{ padding: '16px 20px' }}>
                {/* 删除按钮 */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
                  <Button type="danger" theme="solid" icon={<Trash2 size={13} />} size="small" onClick={removeSelected}>
                    删除当前菜单
                  </Button>
                </div>

                {/* 表单 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <FieldRow label="菜单名称">
                    <Input
                      value={sel.name}
                      maxLength={selected?.l2 == null ? 16 : 60}
                      showClear
                      onChange={(v) => mutateSelected((b) => { b.name = v; })}
                      style={{ width: 220 }}
                    />
                  </FieldRow>

                  {selIsContainer ? (
                    <div style={{ padding: '12px 16px', background: '#fff', borderRadius: 6, fontSize: 12, color: '#888', lineHeight: '20px' }}>
                      该一级菜单含子菜单，作为容器仅需设置名称。<br />
                      删除全部子菜单后可为其单独设置动作。
                    </div>
                  ) : (
                    <>
                      <FieldRow label="菜单内容">
                        <Select
                          style={{ width: 220 }}
                          value={sel.type ?? 'view'}
                          optionList={CONTENT_TYPE_OPTIONS}
                          onChange={(v) => setType(v as string)}
                        />
                      </FieldRow>

                      {(sel.type ?? 'view') === 'view' && (
                        <FieldRow label="网页地址">
                          <Input
                            value={sel.url ?? ''}
                            placeholder="https://"
                            onChange={(v) => mutateSelected((b) => { b.url = v; })}
                            style={{ width: 220 }}
                          />
                        </FieldRow>
                      )}

                      {sel.type === 'click' && (
                        <FieldRow label="事件 KEY">
                          <Input
                            value={sel.key ?? ''}
                            placeholder="如 KEY_001"
                            onChange={(v) => mutateSelected((b) => { b.key = v; })}
                            style={{ width: 220 }}
                          />
                        </FieldRow>
                      )}

                      {sel.type === 'miniprogram' && (
                        <>
                          <FieldRow label="AppID">
                            <Input
                              value={sel.appid ?? ''}
                              placeholder="wx..."
                              onChange={(v) => mutateSelected((b) => { b.appid = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                          <FieldRow label="页面路径">
                            <Input
                              value={sel.pagepath ?? ''}
                              placeholder="pages/index"
                              onChange={(v) => mutateSelected((b) => { b.pagepath = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                          <FieldRow label="兜底网页">
                            <Input
                              value={sel.url ?? ''}
                              placeholder="https://（低版本回退）"
                              onChange={(v) => mutateSelected((b) => { b.url = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                        </>
                      )}

                      {selIsTopLevelLeaf && (
                        <div style={{ paddingTop: 4 }}>
                          <Button
                            theme="light"
                            type="primary"
                            icon={<Plus size={13} />}
                            onClick={() => selected && addSub(selected.l1)}
                          >
                            添加子菜单
                          </Button>
                          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                            添加子菜单后，此菜单将作为子菜单组的标题
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <Empty description="← 点击左侧手机菜单按钮进行编辑" style={{ paddingTop: 80 }} />
            )}
          </div>

        </div>
      </Spin>
    </div>
  );
}

function FieldRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 13, color: '#555', width: 70, flexShrink: 0, textAlign: 'right' }}>{label}：</span>
      {children}
    </div>
  );
}

const CONTENT_TYPE_OPTIONS = [
  { label: '跳转网址', value: 'view' },
  { label: '点击事件', value: 'click' },
  { label: '跳转小程序', value: 'miniprogram' },
];

type Sel = { l1: number; l2: number | null } | null;

const clone = (b: MpMenuButton[]): MpMenuButton[] => JSON.parse(JSON.stringify(b)) as MpMenuButton[];

export default function MpMenuPage() {
  const { hasPermission: can } = usePermission();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();

  const [menu, setMenu] = useState<MpMenu | null>(null);
  const [buttons, setButtons] = useState<MpMenuButton[]>([]);
  const [selected, setSelected] = useState<Sel>(null);
  const [activeL1, setActiveL1] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'pull' | 'delete'>('');

  const load = useCallback(async (accountId: number) => {
    setLoading(true);
    try {
      const res = await request.get<MpMenu>(`/api/mp/menu?accountId=${accountId}`);
      setMenu(res.data ?? null);
      setButtons(res.data?.buttons ?? []);
      setSelected(null);
      setActiveL1(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (currentId) void load(currentId);
    else { setButtons([]); setMenu(null); setSelected(null); setActiveL1(null); }
  }, [currentId, load]);

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
    const l1 = next.length - 1;
    setSelected({ l1, l2: null });
    setActiveL1(null);
  };

  const addSub = (l1: number) => {
    const next = clone(buttons);
    const parent = next[l1];
    parent.sub_button = parent.sub_button ?? [];
    if (parent.sub_button.length >= 5) { Toast.warning('二级菜单最多 5 个'); return; }
    delete parent.type; delete parent.key; delete parent.url; delete parent.appid; delete parent.pagepath;
    parent.sub_button.push({ name: '子菜单', type: 'view', url: '' });
    setButtons(next);
    setSelected({ l1, l2: parent.sub_button.length - 1 });
    setActiveL1(l1);
  };

  const removeSelected = () => {
    if (!selected) return;
    const next = clone(buttons);
    if (selected.l2 == null) {
      next.splice(selected.l1, 1);
      setActiveL1(null);
    } else {
      next[selected.l1].sub_button!.splice(selected.l2, 1);
      if (next[selected.l1].sub_button!.length === 0) {
        delete next[selected.l1].sub_button;
        setActiveL1(null);
      }
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
      if (res.code === 0) {
        Toast.success('已从微信拉取');
        setMenu(res.data ?? null);
        setButtons(res.data?.buttons ?? []);
        setSelected(null);
        setActiveL1(null);
      }
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
          if (res.code === 0) {
            Toast.success('已删除微信菜单');
            setMenu(res.data ?? null);
            setButtons([]);
            setSelected(null);
            setActiveL1(null);
          }
        } finally { setBusy(''); }
      },
    });
  };

  const doClear = () => {
    Modal.confirm({
      title: '确定要清空本地菜单配置吗？',
      content: '此操作仅清空编辑器内容，不影响微信端已发布的菜单。',
      onOk: () => { setButtons([]); setSelected(null); setActiveL1(null); },
    });
  };

  /** 点击底部 tab */
  const handleTabClick = (l1: number) => {
    const btn = buttons[l1];
    if (btn.sub_button?.length) {
      if (activeL1 === l1) {
        setActiveL1(null);
      } else {
        setActiveL1(l1);
        setSelected({ l1, l2: null });
      }
    } else {
      setActiveL1(null);
      setSelected({ l1, l2: null });
    }
  };

  const sel = getSelectedBtn();
  const selIsContainer = selected?.l2 == null && !!buttons[selected?.l1 ?? -1]?.sub_button?.length;
  const selIsTopLevelLeaf = selected?.l2 == null && !selIsContainer;
  const currentAccountName = accounts.find(a => a.id === currentId)?.name ?? '公众号名称';
  const activeSubs = activeL1 !== null ? (buttons[activeL1]?.sub_button ?? []) : [];
  const actionBusy = busy === 'save' || busy === 'publish';

  return (
    <div className="page-container">
      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
        {menu && (menu.status === 'published'
          ? <Tag color="green" type="light">已发布{menu.publishedAt ? ` · ${menu.publishedAt.slice(5, 16)}` : ''}</Tag>
          : <Tag color="grey" type="light">草稿</Tag>)}
        {can('mp:menu:pull') && (
          <Button icon={<RefreshCw size={14} />} loading={busy === 'pull'} disabled={!currentId} onClick={() => void doPull()}>从微信拉取</Button>
        )}
        {can('mp:menu:save') && (
          <Button icon={<Save size={14} />} loading={busy === 'save'} disabled={!currentId} onClick={() => void doSave()}>保存草稿</Button>
        )}
        {can('mp:menu:publish') && (
          <Button type="primary" icon={<Send size={14} />} loading={busy === 'publish'} disabled={!currentId} onClick={() => void doPublish()}>发布到微信</Button>
        )}
        {can('mp:menu:delete') && (
          <Button type="danger" icon={<Trash2 size={14} />} loading={busy === 'delete'} disabled={!currentId} onClick={doDelete}>删除微信菜单</Button>
        )}
      </Space>

      <Spin spinning={loading}>
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* ── 手机预览 ── */}
          <div style={{
            width: 300,
            flexShrink: 0,
            background: '#e2e2e2',
            borderRadius: 44,
            padding: '16px 10px 14px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.18), 0 0 0 2px #c8c8c8',
          }}>
            {/* 顶部装饰：摄像头 + 听筒 */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, background: '#b8b8b8', borderRadius: '50%' }} />
              <div style={{ width: 52, height: 6, background: '#b8b8b8', borderRadius: 3 }} />
              <div style={{ width: 8, height: 8, background: '#b8b8b8', borderRadius: '50%' }} />
            </div>

            {/* 屏幕 */}
            <div style={{
              borderRadius: 20,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: 492,
              background: '#ededed',
              border: '1px solid #c4c4c4',
            }}>
              {/* 状态栏 */}
              <div style={{
                background: '#ededed',
                padding: '5px 14px 4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10,
                color: '#666',
                borderBottom: '1px solid #d8d8d8',
              }}>
                <span>••••• WeChat ☆</span>
                <span style={{ fontWeight: 600, color: '#333' }}>1:21 AM</span>
                <span>100% ▮</span>
              </div>

              {/* 微信顶部导航 */}
              <div style={{
                background: '#ededed',
                borderBottom: '1px solid #d4d4d4',
                padding: '9px 12px',
                display: 'flex',
                alignItems: 'center',
              }}>
                <span style={{ color: '#576B95', fontSize: 13 }}>‹ 返回</span>
                <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600, color: '#191919' }}>
                  {currentAccountName}
                </span>
                <span style={{ color: '#576B95', fontSize: 16 }}>⊙</span>
              </div>

              {/* 聊天内容区（含子菜单弹出层） */}
              <div style={{ flex: 1, background: '#ededed', position: 'relative', overflow: 'hidden' }}>
                {activeL1 !== null && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ background: '#f5f5f5', borderTop: '1px solid #d4d4d4', maxHeight: 280, overflowY: 'auto' }}>
                      {activeSubs.map((sub, l2) => {
                        const isActive = selected?.l1 === activeL1 && selected?.l2 === l2;
                        return (
                          <div
                            key={l2}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setSelected({ l1: activeL1, l2 }); }}
                            onClick={() => setSelected({ l1: activeL1, l2 })}
                            style={{
                              padding: '11px 16px',
                              fontSize: 13,
                              cursor: 'pointer',
                              borderBottom: '1px solid #ebebeb',
                              background: isActive ? '#e8f7e8' : '#fff',
                              color: isActive ? '#07c160' : '#191919',
                              borderLeft: `3px solid ${isActive ? '#07c160' : 'transparent'}`,
                              fontWeight: isActive ? 600 : 400,
                              transition: 'background 0.12s',
                            }}
                          >
                            {sub.name}
                          </div>
                        );
                      })}
                      {activeSubs.length < 5 && (
                        <div
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter') addSub(activeL1); }}
                          onClick={() => addSub(activeL1)}
                          style={{
                            padding: '10px 16px',
                            fontSize: 12,
                            cursor: 'pointer',
                            color: '#07c160',
                            background: '#f9f9f9',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            borderTop: activeSubs.length > 0 ? '1px dashed #ddd' : 'none',
                          }}
                        >
                          <Plus size={12} />
                          添加子菜单
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 底部菜单栏 */}
              <div style={{ background: '#f5f5f5', borderTop: '1px solid #d4d4d4', display: 'flex', minHeight: 48 }}>
                {buttons.map((btn, l1) => {
                  const isHighlighted = selected?.l1 === l1 || activeL1 === l1;
                  return (
                    <div
                      key={l1}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleTabClick(l1); }}
                      onClick={() => handleTabClick(l1)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '10px 4px',
                        fontSize: 12,
                        cursor: 'pointer',
                        borderRight: (l1 < buttons.length - 1 || buttons.length < 3) ? '1px solid #d4d4d4' : 'none',
                        background: isHighlighted ? 'rgba(7,193,96,0.07)' : 'transparent',
                        color: isHighlighted ? '#07c160' : '#191919',
                        fontWeight: isHighlighted ? 600 : 400,
                        minWidth: 0,
                        gap: 2,
                        transition: 'background 0.12s',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', padding: '0 2px' }}>
                        {btn.name}
                      </span>
                      {btn.sub_button?.length ? (
                        <span style={{ fontSize: 8, opacity: 0.6, lineHeight: 1 }}>
                          {activeL1 === l1 ? '▾' : '▴'}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {buttons.length < 3 && (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') addFirstLevel(); }}
                    onClick={addFirstLevel}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#aaa',
                      fontSize: 24,
                      fontWeight: 300,
                      minWidth: 40,
                    }}
                  >
                    +
                  </div>
                )}
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '0 2px' }}>
              <button
                type="button"
                disabled={!currentId || actionBusy}
                onClick={() => void (can('mp:menu:publish') ? doPublish() : doSave())}
                style={{
                  flex: 1,
                  padding: '9px 4px',
                  background: (!currentId || actionBusy) ? '#b0b0b0' : '#07c160',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 20,
                  cursor: (!currentId || actionBusy) ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {actionBusy ? '处理中…' : '保存并发布菜单'}
              </button>
              <button
                type="button"
                onClick={doClear}
                style={{
                  flex: 1,
                  padding: '9px 4px',
                  background: '#e64340',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                清空菜单
              </button>
            </div>
          </div>

          {/* ── 编辑面板 ── */}
          <div style={{ flex: 1, minWidth: 260, background: '#f2f2f2', borderRadius: 8, minHeight: 300 }}>
            {!sel ? (
              <Empty description="← 点击左侧手机菜单按钮进行编辑" style={{ paddingTop: 80 }} />
            ) : (
              <div style={{ padding: '16px 20px' }}>
                {/* 删除按钮 */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
                  <Button type="danger" theme="solid" icon={<Trash2 size={13} />} size="small" onClick={removeSelected}>
                    删除当前菜单
                  </Button>
                </div>

                {/* 表单 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <FieldRow label="菜单名称">
                    <Input
                      value={sel.name}
                      maxLength={selected?.l2 == null ? 16 : 60}
                      showClear
                      onChange={(v) => mutateSelected((b) => { b.name = v; })}
                      style={{ width: 220 }}
                    />
                  </FieldRow>

                  {selIsContainer ? (
                    <div style={{ padding: '12px 16px', background: '#fff', borderRadius: 6, fontSize: 12, color: '#888', lineHeight: '20px' }}>
                      该一级菜单含子菜单，作为容器仅需设置名称。<br />
                      删除全部子菜单后可为其单独设置动作。
                    </div>
                  ) : (
                    <>
                      <FieldRow label="菜单内容">
                        <Select
                          style={{ width: 220 }}
                          value={sel.type ?? 'view'}
                          optionList={CONTENT_TYPE_OPTIONS}
                          onChange={(v) => setType(v as string)}
                        />
                      </FieldRow>

                      {(sel.type ?? 'view') === 'view' && (
                        <FieldRow label="网页地址">
                          <Input
                            value={sel.url ?? ''}
                            placeholder="https://"
                            onChange={(v) => mutateSelected((b) => { b.url = v; })}
                            style={{ width: 220 }}
                          />
                        </FieldRow>
                      )}

                      {sel.type === 'click' && (
                        <FieldRow label="事件 KEY">
                          <Input
                            value={sel.key ?? ''}
                            placeholder="如 KEY_001"
                            onChange={(v) => mutateSelected((b) => { b.key = v; })}
                            style={{ width: 220 }}
                          />
                        </FieldRow>
                      )}

                      {sel.type === 'miniprogram' && (
                        <>
                          <FieldRow label="AppID">
                            <Input
                              value={sel.appid ?? ''}
                              placeholder="wx..."
                              onChange={(v) => mutateSelected((b) => { b.appid = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                          <FieldRow label="页面路径">
                            <Input
                              value={sel.pagepath ?? ''}
                              placeholder="pages/index"
                              onChange={(v) => mutateSelected((b) => { b.pagepath = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                          <FieldRow label="兜底网页">
                            <Input
                              value={sel.url ?? ''}
                              placeholder="https://（低版本回退）"
                              onChange={(v) => mutateSelected((b) => { b.url = v; })}
                              style={{ width: 220 }}
                            />
                          </FieldRow>
                        </>
                      )}

                      {selIsTopLevelLeaf && (
                        <div style={{ paddingTop: 4 }}>
                          <Button
                            theme="light"
                            type="primary"
                            icon={<Plus size={13} />}
                            onClick={() => selected && addSub(selected.l1)}
                          >
                            添加子菜单
                          </Button>
                          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                            添加子菜单后，此菜单将作为子菜单组的标题
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </Spin>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 13, color: '#555', width: 70, flexShrink: 0, textAlign: 'right' }}>{label}：</span>
      {children}
    </div>
  );
}
