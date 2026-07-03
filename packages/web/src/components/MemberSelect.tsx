import { useEffect, useRef, useState } from 'react';
import { Form } from '@douyinfe/semi-ui';
import type { MemberOption } from '@zenith/shared';
import { useMemberOptions } from '@/hooks/queries/members-lookup';

interface MemberSelectProps {
  /** 表单字段名（提交后为会员 id）*/
  field: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

interface OptionItem {
  value: number;
  label: string;
}

function toLabel(m: MemberOption): string {
  const tail = m.phone || m.username;
  return tail ? `${m.nickname}（${tail}）` : m.nickname;
}

/**
 * 会员搜索下拉：按昵称/手机号/用户名远程搜索选择会员。
 * 用于积分调整、钱包调整/退款、发券等需要指定会员的场景。
 */
export function MemberSelect({ field, label = '会员', required, placeholder = '输入昵称/手机号搜索' }: Readonly<MemberSelectProps>) {
  const [keyword, setKeyword] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsQuery = useMemberOptions(keyword || undefined);
  const options: OptionItem[] = (optionsQuery.data ?? []).map((m) => ({ value: m.id, label: toLabel(m) }));

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const handleSearch = (keyword: string) => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = keyword.trim();
    timer.current = setTimeout(() => setKeyword(trimmed), 300);
  };

  return (
    <Form.Select
      field={field}
      label={label}
      placeholder={placeholder}
      style={{ width: '100%' }}
      filter
      remote
      showClear
      loading={optionsQuery.isFetching}
      onSearch={handleSearch}
      optionList={options}
      rules={required ? [{ required: true, message: '请选择会员' }] : undefined}
    />
  );
}
