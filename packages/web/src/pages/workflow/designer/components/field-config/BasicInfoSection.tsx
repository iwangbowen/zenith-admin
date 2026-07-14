// ─── 基础信息设置（名称/字段标识/提示/必填/帮助/默认值，拆分自 FieldConfigPanel.tsx）───
import { useState, useEffect } from 'react';
import { Button, Input, InputNumber, Switch, Typography, Tooltip, Dropdown, TextArea } from '@douyinfe/semi-ui';
import { Wand2 } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared';
import { FIELD_KEY_PATTERN, DYNAMIC_DEFAULT_TOKENS, slugifyToKey, uniqueKey, formulaError } from './helpers';
import type { FieldTypeFlags } from './field-type-flags';

interface BasicInfoSectionProps {
  field: WorkflowFormField;
  flags: FieldTypeFlags;
  otherKeys: Set<string>;
  duplicateKey: boolean;
  /** 全量展平字段（默认值公式引用校验用） */
  flatFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
  onRenameKey?: (newKey: string) => void;
}

export function BasicInfoSection({ field, flags, otherKeys, duplicateKey, flatFields, onChange, onRenameKey }: Readonly<BasicInfoSectionProps>) {
  const { supportsKeyEdit, isDescription, isSerialNumber, isLayout, isSwitch, isSlider, isFormula, isFormatted, isAmountOrNumber } = flags;

  // 字段标识(key) 本地草稿：失焦/回车时校验并提交重命名
  const [keyDraft, setKeyDraft] = useState(field.key);
  useEffect(() => { setKeyDraft(field.key); }, [field.key]);
  const keyError = (() => {
    if (keyDraft === field.key) return null;
    if (!keyDraft.trim()) return '标识不能为空';
    if (!FIELD_KEY_PATTERN.test(keyDraft)) return '需字母开头，仅含字母、数字、下划线';
    if (otherKeys.has(keyDraft)) return '该标识已被占用';
    return null;
  })();
  const commitKey = () => {
    if (keyDraft === field.key) return;
    if (keyError) { setKeyDraft(field.key); return; }
    onRenameKey?.(keyDraft);
  };
  // 根据名称一键生成唯一 key
  const generateKey = () => {
    const next = uniqueKey(slugifyToKey(field.label, field.type), otherKeys);
    setKeyDraft(next);
    onRenameKey?.(next);
  };

  return (
    <>
          {/* 字段名称 */}
          <div className="fd-form-config__field">
            <Typography.Text strong size="small">名称</Typography.Text>
            <Input
              value={field.label}
              onChange={(v) => onChange({ label: v })}
              placeholder="字段名称"
            />
          </div>
          {duplicateKey && (
            <Typography.Text type="danger" size="small" style={{ display: 'block', marginBottom: 12 }}>
              字段 key 重复，运行时取值和联动可能异常，请复制字段或重新添加以生成唯一 key。
            </Typography.Text>
          )}

          {/* 字段标识(key)：提交数据键 + 公式/联动引用锚点，修改自动级联同步引用 */}
          {supportsKeyEdit && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">字段标识(key)</Typography.Text>
              <Input
                value={keyDraft}
                onChange={setKeyDraft}
                onBlur={commitKey}
                onEnterPress={commitKey}
                placeholder="字母开头，仅含字母/数字/下划线"
                validateStatus={keyError ? 'error' : 'default'}
                suffix={(
                  <Tooltip content={field.label.trim() ? '根据名称生成 key' : '请先填写名称'}>
                    <Button
                      icon={<Wand2 size={13} />}
                      size="small" theme="borderless" type="tertiary"
                      disabled={!field.label.trim()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={generateKey}
                      aria-label="根据名称生成 key"
                    />
                  </Tooltip>
                )}
              />
              {keyError ? (
                <Typography.Text type="danger" size="small">{keyError}</Typography.Text>
              ) : (
                <Typography.Text type="tertiary" size="small">用于提交数据与公式/联动引用；修改会自动同步所有引用</Typography.Text>
              )}
            </div>
          )}

          {/* 占位文字（非说明文字、流水号、布局类型、开关、滑块） */}
          {!isDescription && !isSerialNumber && !isLayout && !isSwitch && !isSlider && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">提示文字</Typography.Text>
              <Input
                value={field.placeholder ?? ''}
                onChange={(v) => onChange({ placeholder: v || undefined })}
                placeholder="请输入提示文字"
              />
            </div>
          )}

          {/* 必填开关（非说明文字、流水号、布局类型、公式、开关） */}
          {!isDescription && !isSerialNumber && !isLayout && !isFormula && !isSwitch && (
            <div className="fd-form-config__field fd-form-config__field--inline">
              <Typography.Text strong size="small">必填</Typography.Text>
              <Switch
                checked={field.required ?? false}
                onChange={(v) => onChange({ required: v })}
                size="small"
              />
            </div>
          )}

          {/* 帮助提示（非纯展示） */}
          {!isDescription && !isLayout && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">帮助提示</Typography.Text>
              <Input
                value={field.helpText ?? ''}
                onChange={(v) => onChange({ helpText: v || undefined })}
                placeholder="显示在字段下方的辅助说明"
              />
            </div>
          )}

          {/* 默认值（简单类型） */}
          {(field.type === 'text' || isFormatted) && (
            <div className="fd-form-config__field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography.Text strong size="small">默认值</Typography.Text>
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  render={(
                    <Dropdown.Menu>
                      {DYNAMIC_DEFAULT_TOKENS.map((t) => (
                        <Dropdown.Item
                          key={t.token}
                          onClick={() => onChange({ defaultValue: `${typeof field.defaultValue === 'string' ? field.defaultValue : ''}${t.token}` })}
                        >
                          {t.label} <Typography.Text type="tertiary" size="small">{t.token}</Typography.Text>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  )}
                >
                  <Button size="small" theme="borderless" type="tertiary">插入变量</Button>
                </Dropdown>
              </div>
              <Input
                value={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
                onChange={(v) => onChange({ defaultValue: v || undefined })}
                placeholder="留空表示无默认值，支持 ${currentUser} 等动态变量"
              />
            </div>
          )}
          {isAmountOrNumber && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">默认值</Typography.Text>
              <InputNumber
                value={field.defaultValue as number | undefined}
                onChange={(v) => onChange({ defaultValue: v === undefined || v === '' ? undefined : Number(v) })}
                placeholder="留空表示无默认值"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* 默认值公式：打开表单时按其它字段默认值求值一次（与静态默认值二选一，公式优先） */}
          {(field.type === 'text' || isAmountOrNumber) && (
            <div className="fd-form-config__field">
              <Typography.Text strong size="small">默认值公式</Typography.Text>
              <TextArea
                value={field.defaultFormula ?? ''}
                onChange={(v) => onChange({ defaultFormula: v || undefined })}
                placeholder={'如 {price}*{qty}、CONCAT({dept},"-",{name})'}
                rows={2}
              />
              {(() => {
                const err = field.defaultFormula ? formulaError(field.defaultFormula, flatFields, field.key) : null;
                return err
                  ? <Typography.Text type="danger" size="small">{err}</Typography.Text>
                  : (
                    <Typography.Text type="tertiary" size="small">
                      打开表单时按各字段默认值计算一次；已有值（草稿恢复）不覆盖
                    </Typography.Text>
                  );
              })()}
            </div>
          )}
    </>
  );
}
