/**
 * 运营号底部菜单配置抽屉（公众号风格）
 *
 * 约束：最多 3 个一级菜单，每个一级菜单下最多 5 个二级菜单。
 *  - 含子菜单的一级菜单作为容器（点击展开子菜单），自身不触发动作。
 *  - 叶子菜单：click=发送关键词（value 缺省取菜单名）；view=跳转链接（value 为 URL）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Select, SideSheet, Space, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ChannelMenu, ChannelMenuType } from '@zenith/shared';
import { request } from '@/utils/request';

interface Props {
  channelId: number;
  channelName: string;
  visible: boolean;
  readOnly?: boolean;
  onClose: () => void;
}

interface EditChild {
  name: string;
  type: ChannelMenuType;
  value: string;
}
interface EditTop extends EditChild {
  children: EditChild[];
}

const { Text } = Typography;
const TYPE_OPTIONS = [
  { label: '关键词', value: 'click' },
  { label: '跳转链接', value: 'view' },
];

function fromMenu(m: ChannelMenu): EditChild {
  return { name: m.name, type: m.type, value: m.value ?? '' };
}

export function ChannelMenuDrawer({ channelId, channelName, visible, readOnly = false, onClose }: Readonly<Props>) {
  const [tops, setTops] = useState<EditTop[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<ChannelMenu[]>(`/api/channels/${channelId}/menus`, { silent: true });
      if (res.code === 0 && res.data) {
        setTops(res.data.map((t) => ({
          ...fromMenu(t),
          children: (t.children ?? []).map(fromMenu),
        })));
      }
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (visible) void fetchMenus();
  }, [visible, fetchMenus]);

  const updateTop = (idx: number, patch: Partial<EditTop>) => {
    setTops((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };
  const updateChild = (ti: number, ci: number, patch: Partial<EditChild>) => {
    setTops((prev) => prev.map((t, i) => (i === ti
      ? { ...t, children: t.children.map((c, j) => (j === ci ? { ...c, ...patch } : c)) }
      : t)));
  };
  const addTop = () => {
    if (tops.length >= 3) return;
    setTops((prev) => [...prev, { name: '', type: 'click', value: '', children: [] }]);
  };
  const removeTop = (idx: number) => setTops((prev) => prev.filter((_, i) => i !== idx));
  const addChild = (ti: number) => {
    setTops((prev) => prev.map((t, i) => (i === ti && t.children.length < 5
      ? { ...t, children: [...t.children, { name: '', type: 'click', value: '' }] }
      : t)));
  };
  const removeChild = (ti: number, ci: number) => {
    setTops((prev) => prev.map((t, i) => (i === ti
      ? { ...t, children: t.children.filter((_, j) => j !== ci) }
      : t)));
  };

  const validate = (): boolean => {
    for (const t of tops) {
      if (!t.name.trim()) { Toast.error('一级菜单名称不能为空'); return false; }
      if (t.children.length === 0) {
        if (t.type === 'view' && !t.value.trim()) { Toast.error(`菜单「${t.name}」需填写跳转链接`); return false; }
      } else {
        for (const c of t.children) {
          if (!c.name.trim()) { Toast.error(`「${t.name}」下的子菜单名称不能为空`); return false; }
          if (c.type === 'view' && !c.value.trim()) { Toast.error(`子菜单「${c.name}」需填写跳转链接`); return false; }
        }
      }
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        menus: tops.map((t) => (t.children.length > 0
          ? { name: t.name.trim(), type: 'click' as ChannelMenuType, value: null, children: t.children.map((c) => ({ name: c.name.trim(), type: c.type, value: c.value.trim() || null })) }
          : { name: t.name.trim(), type: t.type, value: t.value.trim() || null })),
      };
      const res = await request.put(`/api/channels/${channelId}/menus`, payload);
      if (res.code === 0) { Toast.success('已保存'); onClose(); }
    } finally {
      setSaving(false);
    }
  };

  const renderTypeValue = (
    type: ChannelMenuType,
    value: string,
    onType: (t: ChannelMenuType) => void,
    onValue: (v: string) => void,
  ) => (
    <Space style={{ width: '100%' }} spacing={8}>
      <Select value={type} onChange={(v) => onType(v as ChannelMenuType)} optionList={TYPE_OPTIONS} style={{ width: 110 }} disabled={readOnly} />
      <Input
        value={value}
        onChange={onValue}
        placeholder={type === 'view' ? '跳转 URL（https://...）' : '关键词（缺省取菜单名）'}
        style={{ width: 280 }}
        disabled={readOnly}
        showClear
      />
    </Space>
  );

  return (
    <SideSheet
      title={`底部菜单 · ${channelName}`}
      visible={visible}
      onCancel={onClose}
      width={620}
      placement="right"
      footer={!readOnly && (
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" theme="solid" loading={saving} onClick={() => void handleSave()}>保存</Button>
        </Space>
      )}
    >
      <Text type="tertiary" size="small">最多 3 个一级菜单，每个一级菜单下最多 5 个二级菜单。</Text>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? null : tops.length === 0 ? (
          <Empty description="暂无菜单，点击下方按钮新增" style={{ padding: 24 }} />
        ) : tops.map((t, ti) => (
          <div key={ti} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text strong style={{ flexShrink: 0 }}>一级菜单 {ti + 1}</Text>
              <Input value={t.name} onChange={(v) => updateTop(ti, { name: v })} placeholder="菜单名称（≤6 字）" maxLength={32} style={{ flex: 1 }} disabled={readOnly} />
              {!readOnly && <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => removeTop(ti)} />}
            </div>

            {t.children.length === 0 && (
              <div style={{ marginBottom: 8 }}>
                {renderTypeValue(t.type, t.value, (type) => updateTop(ti, { type }), (value) => updateTop(ti, { value }))}
              </div>
            )}

            {t.children.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid var(--semi-color-fill-1)' }}>
                {t.children.map((c, ci) => (
                  <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Input value={c.name} onChange={(v) => updateChild(ti, ci, { name: v })} placeholder="子菜单名称" maxLength={32} style={{ width: 130 }} disabled={readOnly} />
                    {renderTypeValue(c.type, c.value, (type) => updateChild(ti, ci, { type }), (value) => updateChild(ti, ci, { value }))}
                    {!readOnly && <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} onClick={() => removeChild(ti, ci)} />}
                  </div>
                ))}
              </div>
            )}

            {!readOnly && t.children.length < 5 && (
              <Button theme="borderless" size="small" icon={<Plus size={13} />} style={{ marginTop: 8 }} onClick={() => addChild(ti)}>
                添加子菜单
              </Button>
            )}
          </div>
        ))}

        {!readOnly && tops.length < 3 && (
          <Button icon={<Plus size={14} />} onClick={addTop}>添加一级菜单</Button>
        )}
      </div>
    </SideSheet>
  );
}

export default ChannelMenuDrawer;
