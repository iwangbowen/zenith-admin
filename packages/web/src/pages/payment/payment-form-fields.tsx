import { Form, Select } from '@douyinfe/semi-ui';
import type { PaymentAppOption } from './payment-app-options';

/**
 * 支付域表单 / 筛选的共用控件：支付应用、商户配置、币种。
 * 各页只负责选中应用后的联动（清空依赖字段、刷新商户配置候选）。
 */

const CNY_CURRENCY_OPTIONS = [{ value: 'CNY', label: 'CNY · 人民币' }];

export interface PaymentAppFieldProps {
  optionList: PaymentAppOption[];
  loading: boolean;
  /** 选中 / 清空应用时回调（清空为 null），调用方在此重置依赖字段 */
  onChange: (appId: number | null) => void;
  requiredMessage?: string;
}

/** 表单内「支付应用」下拉（field=applicationId，可搜索） */
export function PaymentAppField({ optionList, loading, onChange, requiredMessage = '请选择支付应用' }: Readonly<PaymentAppFieldProps>) {
  return (
    <Form.Select
      field="applicationId"
      label="支付应用"
      style={{ width: '100%' }}
      optionList={optionList}
      filter
      loading={loading}
      onChange={(value) => onChange((value as number | undefined) ?? null)}
      rules={[{ required: true, message: requiredMessage }]}
    />
  );
}

/** 表单内「商户配置」下拉（field=channelConfigId），候选由所选应用绑定的配置决定 */
export function PaymentMerchantConfigField({ optionList, loading }: Readonly<{ optionList: PaymentAppOption[]; loading: boolean }>) {
  return (
    <Form.Select
      field="channelConfigId"
      label="商户配置"
      style={{ width: '100%' }}
      optionList={optionList}
      loading={loading}
      rules={[{ required: true, message: '请选择启用的商户配置' }]}
    />
  );
}

/** 表单内「币种」下拉（field=currency），当前只开放人民币 */
export function PaymentCurrencyField({ disabled }: Readonly<{ disabled?: boolean }>) {
  return (
    <Form.Select
      field="currency"
      label="币种"
      style={{ width: '100%' }}
      optionList={CNY_CURRENCY_OPTIONS}
      disabled={disabled}
      rules={[{ required: true, message: '请选择币种' }]}
    />
  );
}

/** 列表工具栏的「支付应用」筛选（按应用维度查询的列表页） */
export function PaymentAppFilterSelect({ value, onChange, optionList, loading }: Readonly<{
  value: number | undefined;
  onChange: (appId: number) => void;
  optionList: PaymentAppOption[];
  loading: boolean;
}>) {
  return (
    <Select
      placeholder="支付应用"
      value={value}
      onChange={(next) => onChange(next as number)}
      optionList={optionList}
      filter
      loading={loading}
      style={{ width: 180 }}
    />
  );
}
