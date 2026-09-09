/**
 * 移动端人员选择组件：触发字段 + 底部抽屉（搜索、头像列表、勾选、确认）。
 * 供发起自选审批人、审批时自选下一节点审批人、转办选人三处复用。
 *
 * 传入 `onSearch` 即进入远程搜索模式：候选由服务端按关键词返回（`candidates` 已过滤，本地不再二次过滤），
 * 抽屉里的搜索词防抖后回传给父级；`truncated` 用于提示「候选人较多，仅显示部分」。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { Check, ChevronRight, Search } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { useEventCallback } from '@/hooks/useEventCallback';

export interface ApproverCandidate {
  id: number;
  name: string;
}

interface ApproverPickerFieldProps {
  /** 抽屉标题（如节点名 / 转办给） */
  title: string;
  candidates: ApproverCandidate[];
  value: number[];
  onChange: (ids: number[]) => void;
  /** 多选（默认）；单选模式点击候选人即确认 */
  multiple?: boolean;
  placeholder?: string;
  /** 必填未选高亮 */
  error?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** 远程搜索：抽屉搜索词（防抖 300ms）回传，父级据此重新取 `candidates` */
  onSearch?: (keyword: string) => void;
  /** 候选超过服务端限量被截断，提示用户输入姓名搜索 */
  truncated?: boolean;
}

export default function ApproverPickerField({
  title,
  candidates,
  value,
  onChange,
  multiple = true,
  placeholder = '请选择审批人',
  error = false,
  loading = false,
  disabled = false,
  onSearch,
  truncated = false,
}: Readonly<ApproverPickerFieldProps>) {
  const [visible, setVisible] = useState(false);
  const [keyword, setKeyword] = useState('');
  // 抽屉内草稿选择，点「确认」才回写（单选模式点击即回写并关闭）
  const [draft, setDraft] = useState<number[]>([]);
  // 远程搜索后候选会换成另一批人：已选中者的姓名在勾选时记下来，芯片与标签不退化成「用户#id」
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<number, string>>(new Map());

  const remote = onSearch !== undefined;
  const emitSearch = useEventCallback((next: string) => onSearch?.(next));
  const [debouncedKeyword] = useDebouncedValue(keyword.trim(), { wait: 300 });
  useEffect(() => {
    if (remote) emitSearch(debouncedKeyword);
  }, [remote, debouncedKeyword, emitSearch]);

  const candidateNames = useMemo(() => new Map(candidates.map((c) => [c.id, c.name])), [candidates]);
  const nameOf = (id: number) => candidateNames.get(id) ?? pickedNames.get(id) ?? `用户#${id}`;

  const filtered = useMemo(() => {
    if (remote) return candidates;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(kw));
  }, [candidates, keyword, remote]);

  const open = () => {
    if (disabled) return;
    setDraft(value);
    setKeyword('');
    setVisible(true);
  };

  const remember = (id: number) => {
    const name = candidateNames.get(id);
    if (name && pickedNames.get(id) !== name) setPickedNames((prev) => new Map(prev).set(id, name));
  };

  const toggle = (id: number) => {
    remember(id);
    if (!multiple) {
      onChange([id]);
      setVisible(false);
      return;
    }
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const confirm = () => {
    onChange(draft);
    setVisible(false);
  };

  return (
    <>
      <div
        className={`ap-picker-field${error ? ' ap-picker-field--error' : ''}${disabled ? ' ap-picker-field--disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={title}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
      >
        {value.length === 0
          ? <span className="ap-picker-field__placeholder">{placeholder}</span>
          : (
            <span className="ap-picker-field__chips">
              {value.map((id) => (
                <span key={id} className="ap-picker-field__chip">
                  <UserAvatar name={nameOf(id)} semiSize="extra-extra-small" size={20} />
                  {nameOf(id)}
                </span>
              ))}
            </span>
          )}
        <ChevronRight size={16} className="ap-picker-field__arrow" />
      </div>

      <SideSheet
        placement="bottom"
        height="auto"
        title={title}
        visible={visible}
        onCancel={() => setVisible(false)}
        className="ap-sheet ap-picker-sheet"
        zIndex={1060}
      >
        <div className="ap-sheet__body">
          <Input
            prefix={<Search size={14} />}
            placeholder={remote ? '输入姓名 / 用户名搜索' : '搜索姓名'}
            value={keyword}
            onChange={setKeyword}
            showClear
            className="ap-picker__search"
          />
          {truncated && !keyword.trim() && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '4px 0 8px' }}>
              候选人较多，仅显示前 {candidates.length} 位，请输入姓名搜索
            </Typography.Text>
          )}
          {multiple && draft.length > 0 && (
            <div className="ap-picker__selected">
              {draft.map((id) => (
                <Tag key={id} closable onClose={() => setDraft((prev) => prev.filter((x) => x !== id))}>
                  {nameOf(id)}
                </Tag>
              ))}
            </div>
          )}
          <div className="ap-picker__list">
            {loading && <div className="ap-picker__loading"><Spin /></div>}
            {!loading && filtered.length === 0 && (
              <Empty description={keyword ? '没有匹配的人员' : '暂无可选人员'} style={{ padding: '24px 0' }} />
            )}
            {!loading && filtered.map((c) => {
              const checked = multiple ? draft.includes(c.id) : value.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`ap-picker__item${checked ? ' ap-picker__item--checked' : ''}`}
                  role="option"
                  aria-selected={checked}
                  tabIndex={0}
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggle(c.id); }}
                >
                  <UserAvatar name={c.name} semiSize="extra-small" size={28} />
                  <span className="ap-picker__item-name">{c.name}</span>
                  {checked && <Check size={18} className="ap-picker__item-check" />}
                </div>
              );
            })}
          </div>
          {multiple && (
            <div className="ap-sheet__actions">
              <Button block theme="light" disabled={draft.length === 0} onClick={() => setDraft([])}>清空</Button>
              <Button block theme="solid" type="primary" onClick={confirm}>
                确认{draft.length > 0 ? `（${draft.length}）` : ''}
              </Button>
            </div>
          )}
        </div>
      </SideSheet>
    </>
  );
}
