/**
 * 通用表格列工具
 *
 * 提供常用的预置列对象和 render 辅助函数，避免在每个页面重复手写。
 */
/* eslint-disable react-refresh/only-export-components -- 纯工具模块（列工厂 / render 辅助 / 常量再导出），不导出组件 */
import { Popover, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { Check } from 'lucide-react';
import { COMMON_STATUS_LABELS } from '@zenith/shared/core';
import DateTimeText from '@/components/DateTimeText';
import OverflowTagList, { type OverflowTagItem } from '@/components/OverflowTagList';
import { formatDate } from './date';
import { EMPTY_PLACEHOLDER } from './empty-placeholder';

export { EMPTY_PLACEHOLDER };

/** 日期时间列（YYYY-MM-DD HH:mm:ss）统一宽度 */
export const DATE_TIME_COLUMN_WIDTH = 180;

/** 纯日期列（YYYY-MM-DD）统一宽度 */
export const DATE_COLUMN_WIDTH = 120;

/** 两个完整日期与区间分隔符，保证日期范围单行展示。 */
export const DATE_RANGE_COLUMN_WIDTH = 260;

/**
 * 带省略 tooltip 的文本 render，空值自动显示 '—'
 *
 * @example
 * { title: '描述', dataIndex: 'description', render: renderEllipsis }
 */
export function renderEllipsis(v: string | null | undefined): React.ReactNode {
  return (
    <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
      {v || EMPTY_PLACEHOLDER}
    </Typography.Text>
  );
}

/** 带代码字体的单行省略文本，适用于 Query ID、Key 等技术标识。 */
export function renderCodeEllipsis(v: string | null | undefined): React.ReactNode {
  return (
    <Typography.Text code ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
      {v || EMPTY_PLACEHOLDER}
    </Typography.Text>
  );
}

/** 业务单号列（genNo 生成的定长编号）统一宽度：26 字符 + 复制图标完整单行展示 */
export const NO_COLUMN_WIDTH = 280;

/**
 * 复制成功的行内反馈：仅一个对勾图标。
 * Semi 默认的「✓ 复制成功」文字比复制图标宽得多，会把定宽单元格撑溢出；
 * 图标反馈与复制图标同宽，原位提示且不打扰（不弹 Toast）。
 */
const COPY_SUCCESS_TIP = (
  <Check size={14} aria-label="复制成功" style={{ color: 'var(--semi-color-success)', verticalAlign: 'text-bottom' }} />
);

/**
 * 可复制列（业务单号 / 编码 / Key 等）：
 * 文本超出列宽时省略并出 tooltip，复制按钮恒定可见，空值显示 '—'。
 *
 * 实现要点：文本与复制按钮是两个独立节点（flex 布局，按钮 flexShrink: 0）。
 * **禁止**改回「同一个 Typography.Text 上同时挂 ellipsis + copyable」——Semi
 * 合并测量偏保守，会把列宽足够容纳的定长单号误截断且不随列宽恢复；
 * 拆开后文本按真实剩余宽度截断，图标永不溢出，超长单号也无需再为它加宽列。
 *
 * 展示与复制默认都取字段原值；两者需要分离时用 `displayText` / `copyContent`：
 * 展示紧凑形态复制完整值（短链）、打码展示复制真值（令牌）、拼接派生值（连接地址）。
 * 转换只产出**纯文本**——单元格里还要放其他节点 / 按钮的复合列不适用本工厂。
 *
 * @example
 * copyableNoColumn('订单号', 'orderNo')
 * copyableNoColumn('批次号', 'batchNo', { width: 300, fixed: 'left' })
 * copyableNoColumn('退款单号', 'refundNo', { flex: true })  // 作为表格的弹性主列吸收剩余宽度
 * copyableNoColumn('短链', 'code', { displayText: (v) => `/s/${v}`, copyContent: (_, r) => r.shortUrl })
 * copyableNoColumn('令牌', 'token', { displayText: maskToken })  // 复制仍是原值
 */
export function copyableNoColumn<RecordType extends Data = Data>(
  title: string,
  dataIndex: string,
  options?: Pick<ColumnProps<RecordType>, 'width' | 'fixed' | 'sorter'> & {
    /** 展示文本转换（打码、加前缀、拼接派生等）；默认展示字段原值 */
    displayText?: (value: string, record: RecordType) => string;
    /** 复制内容；默认复制字段**原值**（不是展示文本） */
    copyContent?: (value: string, record: RecordType) => string;
    /** 作为弹性主列：不设 width、以 NO_COLUMN_WIDTH 为最小宽度（表格没有其他长文本列时使用） */
    flex?: boolean;
  },
): ColumnProps<RecordType> {
  const { displayText, copyContent, flex, ...columnProps } = options ?? {};
  return {
    title,
    dataIndex,
    ...(flex ? { minWidth: NO_COLUMN_WIDTH } : { width: NO_COLUMN_WIDTH }),
    ...columnProps,
    render: (v: string | null | undefined, record: RecordType) => {
      if (!v) return EMPTY_PLACEHOLDER;
      const text = displayText ? displayText(v, record) : v;
      const content = copyContent ? copyContent(v, record) : v;
      return (
        // stopPropagation：expandRowByClick 的表格里，点复制按钮/选中单号不应触发行展开
        <span
          role="presentation"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ minWidth: 0 }}>{text}</Typography.Text>
          <Typography.Text style={{ flexShrink: 0 }} copyable={{ content, successTip: COPY_SUCCESS_TIP }} />
        </span>
      );
    },
  };
}

export interface OverflowTagColumnOptions<RecordType extends Data = Data> {
  readonly title: React.ReactNode;
  readonly dataIndex: string;
  readonly width: number;
  readonly contentWidth: number | string;
  readonly getItems: (value: unknown, record: RecordType) => readonly OverflowTagItem[];
  readonly tagColor?: React.ComponentProps<typeof Tag>['color'];
  readonly tagSize?: React.ComponentProps<typeof Tag>['size'];
  readonly popoverWidth?: number | string;
  readonly popoverTrigger?: React.ComponentProps<typeof Popover>['trigger'];
  readonly empty?: React.ReactNode | ((value: unknown, record: RecordType) => React.ReactNode);
  readonly onClick?: (record: RecordType) => void;
}

/**
 * 标签溢出列：单行展示标签，超出部分收纳到 +N Popover，避免表格行高被撑开。
 * 页面只负责把业务值转换为 `{ key, label }`，视觉与溢出行为统一由 OverflowTagList 处理。
 */
export function overflowTagColumn<RecordType extends Data = Data>({
  title,
  dataIndex,
  width,
  contentWidth,
  getItems,
  tagColor,
  tagSize,
  popoverWidth,
  popoverTrigger,
  empty = EMPTY_PLACEHOLDER,
  onClick,
}: OverflowTagColumnOptions<RecordType>): ColumnProps<RecordType> {
  return {
    title,
    dataIndex,
    width,
    render: (value: unknown, record: RecordType) => {
      const items = getItems(value, record);
      if (items.length === 0) return typeof empty === 'function' ? empty(value, record) : empty;
      return (
        <OverflowTagList
          items={items}
          contentWidth={contentWidth}
          tagColor={tagColor}
          tagSize={tagSize}
          popoverWidth={popoverWidth}
          popoverTrigger={popoverTrigger}
          onClick={onClick ? () => onClick(record) : undefined}
        />
      );
    },
  };
}

/**
 * 只读的启用 / 禁用状态标签：文案取 `COMMON_STATUS_LABELS`、配色与字典 `common_status` 种子一致（启用绿、禁用灰），
 * 与 `<DictTag dictCode="common_status">` 渲染结果相同但不依赖字典请求。可切换的状态列用 `useStatusToggle().column()`。
 */
export function renderEnabledStatusTag(value: string): React.ReactNode {
  const enabled = value === 'enabled';
  return (
    <Tag color={enabled ? 'green' : 'grey'} size="small">
      {enabled ? COMMON_STATUS_LABELS.enabled : COMMON_STATUS_LABELS.disabled}
    </Tag>
  );
}

/**
 * 只读的启用 / 禁用状态列（默认「状态」/ `status` / 80 / `fixed: 'right'`，与 `useStatusToggle().column()` 同位同宽），
 * 用于当前用户不可切换、或在别处（详情 / 弹窗）切换状态的列表。
 *
 * @example
 * const columns = [..., enabledStatusColumn(), createOperationColumn(...)];
 * enabledStatusColumn({ fixed: undefined })   // 弹窗内的小表格不固定
 */
export function enabledStatusColumn<RecordType extends Data = Data>(
  options: Omit<ColumnProps<RecordType>, 'render'> = {},
): ColumnProps<RecordType> {
  return {
    title: '状态',
    dataIndex: 'status',
    width: 80,
    fixed: 'right',
    ...options,
    render: renderEnabledStatusTag,
  };
}

type DateColumnValue = Date | string | number | null | undefined;

/** 时间戳数值的单位；后端多数返回字符串时间，Docker 等外部系统返回 unix 秒 */
type TimeUnit = 'millisecond' | 'second';

type TimeColumnOptions<RecordType extends Data> = Omit<
  ColumnProps<RecordType>,
  'title' | 'dataIndex' | 'render'
> & {
  /** 空值展示文案，用于「永久」「未发布」等语义化占位；默认 '—' */
  empty?: string;
  /** 数值时间戳的单位，默认毫秒；unix 秒时间戳传 'second' */
  unit?: TimeUnit;
};

function createTimeColumn<RecordType extends Data>(
  format: ((value: DateColumnValue) => string) | 'date-time',
  defaultWidth: number,
  title: string,
  dataIndex: string,
  options: TimeColumnOptions<RecordType> = {},
): ColumnProps<RecordType> {
  const { empty = EMPTY_PLACEHOLDER, width = defaultWidth, unit = 'millisecond', ...rest } = options;
  return {
    title,
    dataIndex,
    width,
    ...rest,
    render: (value: unknown) => {
      if (!value) return empty;
      const input = (unit === 'second' && typeof value === 'number'
        ? value * 1000
        : value) as DateColumnValue;
      // 日期时间列跟随「时间显示方式」偏好（绝对 / 相对）；纯日期列没有相对语义，保持绝对
      return format === 'date-time' ? <DateTimeText value={input} empty={empty} /> : format(input);
    },
  };
}

/**
 * 日期时间列（统一宽度 180，默认 YYYY-MM-DD HH:mm:ss，偏好为相对时间时显示「3 分钟前」并悬停给出精确时刻，空值显示 '—'）
 *
 * @example
 * dateTimeColumn('支付时间', 'paidAt')
 * dateTimeColumn('过期时间', 'expiresAt', { empty: '永久有效' })
 * dateTimeColumn('创建时间', 'created', { unit: 'second' })
 */
export function dateTimeColumn<RecordType extends Data = Data>(
  title: string,
  dataIndex: string,
  options?: TimeColumnOptions<RecordType>,
): ColumnProps<RecordType> {
  return createTimeColumn('date-time', DATE_TIME_COLUMN_WIDTH, title, dataIndex, options);
}

/**
 * 纯日期列（统一宽度 120，格式化为 YYYY-MM-DD，空值显示 '—'）
 *
 * @example
 * dateColumn('账单日期', 'billDate')
 */
export function dateColumn<RecordType extends Data = Data>(
  title: string,
  dataIndex: string,
  options?: TimeColumnOptions<RecordType>,
): ColumnProps<RecordType> {
  return createTimeColumn(formatDate, DATE_COLUMN_WIDTH, title, dataIndex, options);
}

/**
 * 创建时间列
 *
 * @example
 * const columns = [..., createdAtColumn];
 */
export const createdAtColumn: ColumnProps = dateTimeColumn('创建时间', 'createdAt');

/**
 * 更新时间列
 *
 * @example
 * const columns = [..., updatedAtColumn];
 */
export const updatedAtColumn: ColumnProps = dateTimeColumn('更新时间', 'updatedAt');
