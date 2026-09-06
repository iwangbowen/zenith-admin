import { InputNumber, Radio, RadioGroup, Select, Typography, Form } from '@douyinfe/semi-ui';

export type SelectScopeType = 'user' | 'role' | 'department' | 'userGroup';
type MultiLevelEndType = 'topLevel' | 'level' | 'role';

interface SelectScopeFieldsProps {
  scopeType: SelectScopeType;
  scopeIds: number[];
  scopeOptions: Array<{ value: number; label: string }>;
  onChange: (updates: Record<string, unknown>) => void;
  label: string;
  allowEmpty: boolean;
  help: string;
}

export function SelectScopeFields({
  scopeType,
  scopeIds,
  scopeOptions,
  onChange,
  label,
  allowEmpty,
  help,
}: Readonly<SelectScopeFieldsProps>) {
  return (
    <>
      <Form.Slot label="可选范围类型">
        <RadioGroup
          type="button"
          value={scopeType}
          onChange={(event) => onChange({ selectScopeType: event.target.value, selectScopeIds: [] })}
          style={{ width: '100%' }}
        >
          <Radio value="user">成员</Radio>
          <Radio value="role">角色</Radio>
          <Radio value="department">部门</Radio>
          <Radio value="userGroup">用户组</Radio>
        </RadioGroup>
      </Form.Slot>
      <Form.Slot label={label}>
        <Select
          value={scopeIds}
          onChange={(value) => onChange({ selectScopeIds: value })}
          multiple
          filter
          style={{ width: '100%' }}
          placeholder={allowEmpty ? '可选范围，留空则上一审批人可任选' : '请选择可供发起人挑选的范围'}
          optionList={scopeOptions}
        />
      </Form.Slot>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        {help}
      </Typography.Text>
    </>
  );
}

interface MultiLevelEndFieldsProps {
  endType: MultiLevelEndType;
  endLevel: number;
  endRoleId?: number;
  roles: Array<{ id: number; name: string }>;
  includeRole: boolean;
  topLevelLabel: string;
  onChange: (updates: Record<string, unknown>) => void;
  help: string;
}

export function MultiLevelEndFields({
  endType,
  endLevel,
  endRoleId,
  roles,
  includeRole,
  topLevelLabel,
  onChange,
  help,
}: Readonly<MultiLevelEndFieldsProps>) {
  return (
    <>
      <Form.Slot label="审批终点">
        <Select
          value={endType}
          onChange={(value) => onChange({ multiLevelEndType: value })}
          style={{ width: '100%' }}
          optionList={[
            { value: 'topLevel', label: topLevelLabel },
            { value: 'level', label: '指定层级' },
            ...(includeRole ? [{ value: 'role', label: '指定角色' }] : []),
          ]}
          placeholder="请选择审批终点"
        />
      </Form.Slot>
      {endType === 'level' && (
        <Form.Slot label="终止层级">
          <InputNumber
            value={endLevel}
            onChange={(value) => onChange({ multiLevelEndLevel: value })}
            min={1}
            max={20}
            style={{ width: 200 }}
            suffix="级"
            placeholder="请输入层级"
          />
        </Form.Slot>
      )}
      {includeRole && endType === 'role' && (
        <Form.Slot label="终止角色">
          <Select
            value={endRoleId}
            onChange={(value) => onChange({ multiLevelEndRoleId: value })}
            style={{ width: '100%' }}
            placeholder="审批到该角色后停止"
            optionList={roles.map((role) => ({ value: role.id, label: role.name }))}
          />
        </Form.Slot>
      )}
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
        {help}
      </Typography.Text>
    </>
  );
}
