/**
 * 设计器操作按钮默认值回归测试。
 *
 * 曾经设计器自持一份默认值（转办/委派/加签/退回默认开启），与运行时审批面板、
 * 服务端动作校验的默认关闭相互矛盾：未配置按钮的节点在画布里显示已开启，
 * 服务端却会 403、运行时也会隐藏按钮。这里锁定设计器与服务端共用同一份事实源。
 */
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTION_BUTTONS, WORKFLOW_ACTION_BUTTON_DEFAULTS } from '@zenith/shared/workflow';
import { ACTION_BUTTON_META, getActionButtonConfig, normalizeActionButtons } from './action-buttons';

describe('设计器操作按钮默认值', () => {
  it('可执行动作的默认启用状态与服务端一致', () => {
    expect(Object.fromEntries(ACTION_BUTTON_META.map(meta => [meta.key, meta.defaultEnabled])))
      .toEqual(Object.fromEntries(WORKFLOW_ACTION_BUTTONS.map(meta => [meta.key, meta.defaultEnabled])));
  });

  it('未配置按钮的节点保存后仍只启用通过与拒绝', () => {
    const normalized = normalizeActionButtons(undefined);
    for (const [key, cfg] of Object.entries(WORKFLOW_ACTION_BUTTON_DEFAULTS)) {
      expect(normalized[key as keyof typeof WORKFLOW_ACTION_BUTTON_DEFAULTS]?.enabled).toBe(cfg.enabled);
    }
    expect(normalized.transfer?.enabled).toBe(false);
    expect(normalized.return?.enabled).toBe(false);
  });

  it('已有配置不被覆盖（启用态与文案按用户设置保留）', () => {
    const normalized = normalizeActionButtons({
      transfer: { enabled: true, displayName: '转给同事', opinionName: '说明', uploadMode: 'required' },
      approve: { enabled: false },
    });
    expect(normalized.transfer).toMatchObject({ enabled: true, displayName: '转给同事', opinionName: '说明', uploadMode: 'required' });
    expect(normalized.approve?.enabled).toBe(false);
  });

  it('单个按钮读取时同样回落默认值', () => {
    const meta = ACTION_BUTTON_META.find((item) => item.key === 'addSign')!;
    expect(getActionButtonConfig(undefined, meta).enabled).toBe(false);
  });
});
