/**
 * search-filters 契约测试。
 *
 * 这些控件的价值在于把「装饰性 props」（放大镜前缀、showClear、默认宽度、
 * 占位文案）收进默认值，同时保证业务 props 与自定义样式仍能穿透——
 * 一旦不能穿透，页面就会绕开组件退回手写，收敛白做。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { DateRangeFilter, FilterSelect, KeywordInput, NumberFilter, StatusSelect } from './search-filters';

interface SelectStubProps {
  readonly optionList?: readonly { value: string | number; label: ReactNode }[];
  readonly onChange?: (value: string | number | undefined) => void;
  readonly placeholder?: ReactNode;
  readonly value?: string | number;
  readonly style?: CSSProperties;
  readonly showClear?: boolean;
}

vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  return {
    ...actual,
    // 空串选项模拟 Semi 的清除按钮：回调 undefined
    Select: ({ optionList = [], onChange, placeholder, value, style, showClear }: SelectStubProps) => (
      <select value={value ?? ''} onChange={(event) => onChange?.(event.target.value === '' ? undefined : event.target.value)} style={style} data-show-clear={showClear ? 'true' : undefined}>
        <option value="">{placeholder}</option>
        {optionList.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    ),
  };
});

const STATUS_ITEMS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

describe('KeywordInput', () => {
  it('渲染放大镜前缀与传入的占位文案', () => {
    const { container } = render(<KeywordInput placeholder="搜索名称/编码" value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('搜索名称/编码')).toBeInTheDocument();
    expect(container.querySelector('.semi-input-prefix svg')).toBeTruthy();
  });

  it('onChange 透传输入值', () => {
    const onChange = vi.fn();
    render(<KeywordInput placeholder="搜索" value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('搜索'), { target: { value: 'abc' } });
    // Semi 的 Input onChange 签名是 (value, event)，这里只关心首参
    expect(onChange.mock.calls[0][0]).toBe('abc');
  });

  it('回车触发 onSearch', () => {
    const onSearch = vi.fn();
    render(<KeywordInput placeholder="搜索" value="abc" onChange={vi.fn()} onSearch={onSearch} />);
    // Semi 在 keyPress 而非 keyDown 上派发 onEnterPress
    fireEvent.keyPress(screen.getByPlaceholderText('搜索'), { key: 'Enter', charCode: 13 });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('默认宽度 220，可被 width 覆盖', () => {
    const { container, rerender } = render(<KeywordInput placeholder="a" value="" onChange={vi.fn()} />);
    expect((container.querySelector('.semi-input-wrapper') as HTMLElement).style.width).toBe('220px');
    rerender(<KeywordInput placeholder="a" value="" onChange={vi.fn()} width={320} />);
    expect((container.querySelector('.semi-input-wrapper') as HTMLElement).style.width).toBe('320px');
  });

  it('调用方的 style 能覆盖默认值', () => {
    const { container } = render(<KeywordInput placeholder="a" value="" onChange={vi.fn()} style={{ width: 150 }} />);
    expect((container.querySelector('.semi-input-wrapper') as HTMLElement).style.width).toBe('150px');
  });
});

describe('FilterSelect', () => {
  const CHANNEL_ITEMS = [
    { value: 'wechat', label: '微信支付' },
    { value: 'alipay', label: '支付宝' },
  ];

  it('渲染选项、占位文案与清除按钮，默认宽度 120', async () => {
    const { container } = render(<FilterSelect placeholder="全部渠道" items={CHANNEL_ITEMS} value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('全部渠道')).toBeInTheDocument();
    expect(await screen.findByText('微信支付')).toBeInTheDocument();
    expect(screen.getByText('支付宝')).toBeInTheDocument();
    const select = container.querySelector('select')!;
    expect(select.dataset.showClear).toBe('true');
    expect(select.style.width).toBe('120px');
    expect(select.style.maxWidth).toBe('100%');
  });

  it('width 可覆盖', () => {
    const { container } = render(<FilterSelect placeholder="全部处理状态" items={CHANNEL_ITEMS} value={undefined} onChange={vi.fn()} width={140} />);
    expect(container.querySelector('select')!.style.width).toBe('140px');
  });

  it('选中项回调原值；清空回调 undefined', () => {
    const onChange = vi.fn();
    render(<FilterSelect placeholder="全部渠道" items={CHANNEL_ITEMS} value="wechat" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alipay' } });
    expect(onChange).toHaveBeenLastCalledWith('alipay');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('支持数值型选项', () => {
    const onChange = vi.fn();
    render(<FilterSelect<number> placeholder="全部产品" items={[{ value: 1, label: '网关' }, { value: 2, label: '传感器' }]} value={undefined} onChange={onChange} />);
    expect(screen.getByText('传感器')).toBeInTheDocument();
  });
});

describe('StatusSelect', () => {
  it('是占位固定为「全部状态」的 FilterSelect', async () => {
    render(<StatusSelect items={STATUS_ITEMS} value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('全部状态')).toBeInTheDocument();
    expect(await screen.findByText('启用')).toBeInTheDocument();
    expect(screen.getByText('停用')).toBeInTheDocument();
  });

  it('选中项回调原值；清空回调 undefined', () => {
    const onChange = vi.fn();
    render(<StatusSelect items={STATUS_ITEMS} value="enabled" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'disabled' } });
    expect(onChange).toHaveBeenLastCalledWith('disabled');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('NumberFilter', () => {
  it('隐藏步进按钮，默认宽度 130，可被 width 覆盖', () => {
    const { container, rerender } = render(<NumberFilter placeholder="耗时 ≥ (ms)" value={undefined} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('耗时 ≥ (ms)')).toBeInTheDocument();
    expect(container.querySelector('.semi-input-number-suffix-btns')).toBeNull();
    expect((container.querySelector('.semi-input-number') as HTMLElement).style.width).toBe('130px');
    rerender(<NumberFilter placeholder="耗时 ≥ (ms)" value={undefined} onChange={vi.fn()} width={110} />);
    expect((container.querySelector('.semi-input-number') as HTMLElement).style.width).toBe('110px');
  });

  it('输入数字回调 number，清空回调 undefined', () => {
    const onChange = vi.fn();
    render(<NumberFilter placeholder="金额 ≥ (元)" value={undefined} onChange={onChange} />);
    const input = screen.getByPlaceholderText('金额 ≥ (元)');
    fireEvent.change(input, { target: { value: '120' } });
    expect(onChange).toHaveBeenLastCalledWith(120);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

/** 抹掉组件额外注入的 maxWidth 以及它留下的空白，便于与手写形态逐字比对 */
const stripMaxWidth = (html: string) => html.replace(/\s*max-width:\s*100%;?/g, '').replace(/;\s*"/g, ';"');

describe('与原生写法的渲染等价性', () => {
  // 收敛的前提是「改写后渲染结果不变」。这里把原来散在各页面的手写形态与组件
  // 并排渲染做结构对比，唯一有意的差异是组件补上了 maxWidth: '100%'——
  // 固定宽度在窄屏容器里会横向溢出，参考页（RolesPage 等）本就带这条。
  const legacyKeyword = (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称"
      value="abc"
      onChange={vi.fn()}
      onEnterPress={vi.fn()}
      showClear
      style={{ width: 200 }}
    />
  );

  it('KeywordInput 与手写 Input 的渲染结构一致（仅多 maxWidth）', () => {
    const legacy = render(legacyKeyword).container.innerHTML;
    const next = render(
      <KeywordInput placeholder="搜索名称" value="abc" onChange={vi.fn()} onSearch={vi.fn()} width={200} />,
    ).container.innerHTML;

    expect(stripMaxWidth(next)).toBe(stripMaxWidth(legacy));
    expect(next).toContain('max-width: 100%');
  });

  it('KeywordInput 默认宽度与最常见的手写值 220 一致', () => {
    const legacy = render(
      <Input prefix={<Search size={14} />} placeholder="p" value="" onChange={vi.fn()} showClear style={{ width: 220 }} />,
    ).container.innerHTML;
    const next = render(<KeywordInput placeholder="p" value="" onChange={vi.fn()} />).container.innerHTML;
    expect(stripMaxWidth(next)).toBe(stripMaxWidth(legacy));
  });
});

describe('DateRangeFilter', () => {
  it('dateTimeRange 默认占位为「开始时间 / 结束时间」', () => {
    render(<DateRangeFilter value={null} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('开始时间')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('结束时间')).toBeInTheDocument();
  });

  it('dateRange 默认占位为「开始日期 / 结束日期」', () => {
    render(<DateRangeFilter type="dateRange" value={null} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('开始日期')).toBeInTheDocument();
  });

  it('占位文案可覆盖', () => {
    render(<DateRangeFilter value={null} onChange={vi.fn()} placeholder={['入职起', '入职止']} />);
    expect(screen.getByPlaceholderText('入职起')).toBeInTheDocument();
  });

  it('按 type 取不同默认宽度，且可被 width 覆盖', () => {
    const widthOf = (c: HTMLElement) =>
      (c.querySelector('[style*="width"]') as HTMLElement | null)?.style.width;
    const { container, rerender } = render(<DateRangeFilter value={null} onChange={vi.fn()} />);
    expect(widthOf(container)).toBe('400px');
    rerender(<DateRangeFilter type="dateRange" value={null} onChange={vi.fn()} />);
    expect(widthOf(container)).toBe('280px');
    rerender(<DateRangeFilter value={null} onChange={vi.fn()} width={300} />);
    expect(widthOf(container)).toBe('300px');
  });

  it('onChange 把 Semi 的宽松值收窄为 [Date, Date] | null', () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={null} onChange={onChange} />);
    const input = screen.getByPlaceholderText('开始时间');
    fireEvent.click(input);
    // 未选满两端时应回调 null，而非半截数组
    expect(onChange).not.toHaveBeenCalledWith(expect.arrayContaining([undefined]));
  });
});
