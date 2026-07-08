import type { ReactNode } from 'react';
import { Button, Input } from '@douyinfe/semi-ui';
import { RotateCcw, Search } from 'lucide-react';
import { SearchToolbar } from './SearchToolbar';

interface KeywordSearchToolbarProps {
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** 点击「查询」按钮或输入框回车时触发 */
  readonly onSearch: () => void;
  /** 点击「重置」按钮时触发 */
  readonly onReset: () => void;
  /** 输入框宽度，默认 220 */
  readonly width?: number;
  /** 桌面端「重置」之后的附加操作按钮（移动端收进更多菜单） */
  readonly actions?: ReactNode;
}

/**
 * 仅含「关键字输入 + 查询 + 重置（+ 可选操作按钮）」的标准搜索工具栏。
 * 桌面端平铺展示；移动端露出输入框和查询按钮，重置与附加操作收进更多菜单。
 */
export function KeywordSearchToolbar({ placeholder, value, onChange, onSearch, onReset, width = 220, actions }: KeywordSearchToolbarProps) {
  const keywordInput = (
    <Input
      prefix={<Search size={14} />}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onEnterPress={onSearch}
      showClear
      style={{ width }}
    />
  );
  const searchButton = <Button type="primary" icon={<Search size={14} />} onClick={onSearch}>查询</Button>;
  const resetButton = <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={onReset}>重置</Button>;

  return (
    <SearchToolbar
      primary={(
        <>
          {keywordInput}
          {searchButton}
          {resetButton}
          {actions}
        </>
      )}
      mobilePrimary={(
        <>
          {keywordInput}
          {searchButton}
        </>
      )}
      mobileActions={(
        <>
          {resetButton}
          {actions}
        </>
      )}
    />
  );
}
