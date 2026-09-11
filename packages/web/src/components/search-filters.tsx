/**
 * 列表页搜索工具栏的标准筛选控件。
 *
 * 与 `toolbar-controls.tsx`（查询/重置/新增按钮）配套：那边收敛的是动作按钮，
 * 这边收敛的是筛选输入。二者都只把**装饰性 props**（图标、尺寸、showClear、
 * 默认宽度）收进默认值，业务 props（items/placeholder）仍由页面显式传入，
 * value/onChange 由 `useListSearch` 的 `bind` / `bindKeyword` 整体展开——
 * 否则组件会退化成难以定制的黑盒。
 *
 * @example
 * <ListSearchToolbar
 *   keyword={<KeywordInput placeholder="搜索名称/编码" {...bindKeyword('keyword')} />}
 *   filters={(
 *     <>
 *       <StatusSelect items={statusItems} {...bind('status')} />
 *       <FilterSelect placeholder="全部渠道" items={PAYMENT_CHANNEL_OPTIONS} {...bind('channel')} />
 *     </>
 *   )}
 *   onSearch={handleSearch}
 *   onReset={handleReset}
 * />
 */
import type { ReactNode } from 'react';
import { DatePicker, Input, InputNumber, Select } from '@douyinfe/semi-ui';
import type { InputProps } from '@douyinfe/semi-ui/lib/es/input';
import type { InputNumberProps } from '@douyinfe/semi-ui/lib/es/inputNumber';
import type { SelectProps } from '@douyinfe/semi-ui/lib/es/select';
import type { DatePickerProps } from '@douyinfe/semi-ui/lib/es/datePicker';
import { Search } from 'lucide-react';

interface KeywordInputProps extends Omit<InputProps, 'onChange' | 'value' | 'prefix'> {
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  /** 回车触发查询；等价于 Semi 的 onEnterPress，省去在页面重复写 */
  readonly onSearch?: () => void;
  /** 输入框宽度，默认 220 */
  readonly width?: number | string;
}

/**
 * 关键字搜索输入框：统一放大镜前缀、清除按钮与默认宽度。
 * 改图标或尺寸时只需改这里，不必扫遍两百多个页面。
 */
export function KeywordInput({ value, onChange, onSearch, width = 220, style, ...rest }: KeywordInputProps) {
  return (
    <Input
      prefix={<Search size={14} />}
      value={value}
      onChange={onChange}
      onEnterPress={onSearch}
      showClear
      style={{ width, maxWidth: '100%', ...style }}
      {...rest}
    />
  );
}

export interface FilterOption<V extends string | number = string> {
  readonly value: V;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface FilterOptionGroup<V extends string | number = string> {
  readonly label: string;
  readonly items: readonly FilterOption<V>[];
}

/** 选项来源：平铺 `items`（枚举用 shared 导出的 `XXX_OPTIONS` 或 `useDictItems(...).items`），或按组展示的 `groups` */
type FilterSelectSource<V extends string | number> =
  | { readonly items: readonly FilterOption<V>[]; readonly groups?: never }
  | { readonly groups: readonly FilterOptionGroup<V>[]; readonly items?: never };

interface FilterSelectBaseProps<V extends string | number>
  extends Omit<SelectProps, 'onChange' | 'value' | 'optionList' | 'placeholder' | 'showClear' | 'multiple' | 'children'> {
  /** `undefined` = 不过滤 */
  readonly value: V | undefined;
  /** 清空时回调 `undefined` */
  readonly onChange: (value: V | undefined) => void;
  /** 占位即空值语义，写成「全部 X」（如「全部渠道」） */
  readonly placeholder: string;
  /** 下拉宽度，默认 120；仅在占位或选项文案放不下时加宽 */
  readonly width?: number | string;
}

export type FilterSelectProps<V extends string | number = string> = FilterSelectBaseProps<V> & FilterSelectSource<V>;

/**
 * 单选枚举筛选下拉：占位描述空值含义，清除按钮回到「不过滤」，宽度固定。
 * 列表页搜索栏里所有「全部 X」形态的筛选都用它，不再逐页手写 `showClear` / `style={{ width }}` / 「全部」哨兵选项。
 */
export function FilterSelect<V extends string | number = string>({
  items,
  groups,
  value,
  onChange,
  placeholder,
  width = 120,
  style,
  ...rest
}: FilterSelectProps<V>) {
  const shared = {
    placeholder,
    value,
    onChange: (v: unknown) => onChange(v as V | undefined),
    showClear: true,
    style: { width, maxWidth: '100%', ...style },
    ...rest,
  };
  if (groups) {
    return (
      <Select {...shared}>
        {groups.map((group) => (
          <Select.OptGroup key={group.label} label={group.label}>
            {group.items.map((option) => (
              <Select.Option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</Select.Option>
            ))}
          </Select.OptGroup>
        ))}
      </Select>
    );
  }
  return <Select {...shared} optionList={[...items]} />;
}

export type StatusSelectProps<V extends string = string> = Omit<FilterSelectBaseProps<V>, 'placeholder'> & FilterSelectSource<V>;

/** 状态筛选：`FilterSelect` 的特化，占位固定为「全部状态」 */
export function StatusSelect<V extends string = string>(props: StatusSelectProps<V>) {
  return <FilterSelect<V> {...props} placeholder="全部状态" />;
}

interface NumberFilterProps extends Omit<InputNumberProps, 'onChange' | 'onNumberChange' | 'value' | 'hideButtons'> {
  /** `undefined` = 不过滤 */
  readonly value: number | undefined;
  /** 清空或输入非法值时回调 `undefined` */
  readonly onChange: (value: number | undefined) => void;
  /** 占位说明筛选语义，如「耗时 ≥ (ms)」「金额 ≤ (元)」「外链 ID」 */
  readonly placeholder: string;
  /** 输入框宽度，默认 130 */
  readonly width?: number | string;
}

/**
 * 单个数字筛选（ID / 阈值 / 金额上下界）：隐藏步进按钮、固定宽度，并把 Semi 宽松的
 * `onChange`（`number | string`，清空时为空串）收窄为 `number | undefined`——
 * 页面此前各自手写 `v !== '' && v != null ? Number(v) : null` / `typeof v === 'number' ? v : undefined`。
 * 搭配 `useListSearch` 的 `bind('字段')`，字段声明为可选 `number`。
 */
export function NumberFilter({ value, onChange, width = 130, style, ...rest }: NumberFilterProps) {
  return (
    <InputNumber
      value={value}
      onChange={(v) => {
        const parsed = typeof v === 'number' ? v : (v === '' || v == null ? Number.NaN : Number(v));
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
      hideButtons
      style={{ width, maxWidth: '100%', ...style }}
      {...rest}
    />
  );
}

/**
 * 区间选择器的默认宽度，也是不截断内容的最小宽度：Semi 把两个输入框均分剩余宽度
 * （总宽减去分隔符、图标、边框约 48px，每侧再扣 26px 内边距），`YYYY-MM-DD HH:mm:ss`
 * 在 14px Inter 下宽约 138px，360px 时每侧只剩 131px，末位秒数会被截掉；`YYYY-MM-DD` 约 78px，
 * 260px 时只剩 3px 余量。400 / 280 分别留出约 13px，回退到更宽的中文字体也装得下。
 * 报表筛选条等自定义宽度的场景也应以此为下限。
 */
export const DATE_TIME_RANGE_FILTER_WIDTH = 400;
export const DATE_RANGE_FILTER_WIDTH = 280;

interface DateRangeFilterProps extends Omit<DatePickerProps, 'onChange' | 'value' | 'type'> {
  /** 页面的区间状态用 `null` 或 `undefined` 表示未选择都可以 */
  readonly value: [Date, Date] | null | undefined;
  readonly onChange: (range: [Date, Date] | null) => void;
  /** `dateTimeRange` 精确到秒（默认），`dateRange` 只选日期 */
  readonly type?: 'dateTimeRange' | 'dateRange';
  /** 选择器宽度，默认按 type 取 DATE_TIME_RANGE_FILTER_WIDTH / DATE_RANGE_FILTER_WIDTH；只应为 `100%` 之类的自适应场景覆盖，不要改小 */
  readonly width?: number | string;
}

/**
 * 时间范围筛选：统一占位文案与宽度，并把 Semi 宽松的 onChange 值收窄成
 * `[Date, Date] | null`——页面此前各自手写 `Array.isArray(v) && v.length >= 2` 之类的判断。
 */
export function DateRangeFilter({
  value,
  onChange,
  type = 'dateTimeRange',
  width,
  placeholder,
  style,
  ...rest
}: DateRangeFilterProps) {
  const isDateTime = type === 'dateTimeRange';
  return (
    <DatePicker
      type={type}
      placeholder={placeholder ?? (isDateTime ? ['开始时间', '结束时间'] : ['开始日期', '结束日期'])}
      value={value ?? undefined}
      onChange={(v) => {
        const [from, to] = Array.isArray(v) ? v : [];
        onChange(from instanceof Date && to instanceof Date ? [from, to] : null);
      }}
      style={{ width: width ?? (isDateTime ? DATE_TIME_RANGE_FILTER_WIDTH : DATE_RANGE_FILTER_WIDTH), maxWidth: '100%', ...style }}
      {...rest}
    />
  );
}
