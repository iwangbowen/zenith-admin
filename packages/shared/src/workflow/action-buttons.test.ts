/**
 * 操作按钮默认值契约单测。
 *
 * 锁定 docs/workflow/node-config.md 的约定：未配置按钮时，通过与拒绝默认启用，
 * 其余协作按钮默认关闭。设计器、运行时审批面板与服务端动作校验都必须与这里一致，
 * 否则未配置按钮的节点会出现「设计器显示已开启 / 运行时隐藏 / 接口 403」的漂移。
 */
import { describe, expect, it } from 'vitest';
import {
  isWorkflowActionButtonEnabled,
  resolveWorkflowActionButton,
  WORKFLOW_ACTION_BUTTONS,
  WORKFLOW_ACTION_BUTTON_DEFAULTS,
} from './action-buttons';

describe('WORKFLOW_ACTION_BUTTON_DEFAULTS', () => {
  it('未配置按钮时只有通过与拒绝默认启用', () => {
    const enabled = Object.fromEntries(
      Object.entries(WORKFLOW_ACTION_BUTTON_DEFAULTS).map(([key, cfg]) => [key, cfg.enabled]),
    );
    expect(enabled).toEqual({
      approve: true,
      reject: true,
      transfer: false,
      delegate: false,
      addSign: false,
      reduceSign: false,
      return: false,
    });
  });

  it('覆盖全部七类动作', () => {
    expect(WORKFLOW_ACTION_BUTTONS.map((meta) => meta.key).sort()).toEqual([
      'addSign', 'approve', 'delegate', 'reduceSign', 'reject', 'return', 'transfer',
    ]);
  });
});

describe('resolveWorkflowActionButton', () => {
  it('节点只覆盖显式给出的字段，其余回落默认值', () => {
    const cfg = { transfer: { enabled: true } };
    expect(resolveWorkflowActionButton(cfg, 'transfer')).toEqual({
      enabled: true,
      displayName: WORKFLOW_ACTION_BUTTON_DEFAULTS.transfer.displayName,
      opinionName: WORKFLOW_ACTION_BUTTON_DEFAULTS.transfer.opinionName,
    });
    expect(resolveWorkflowActionButton(cfg, 'return').enabled).toBe(false);
  });
});

describe('isWorkflowActionButtonEnabled', () => {
  it('未配置时按默认启用态判定', () => {
    expect(isWorkflowActionButtonEnabled(null, 'approve')).toBe(true);
    expect(isWorkflowActionButtonEnabled(null, 'transfer')).toBe(false);
  });

  it('显式配置优先于默认值', () => {
    expect(isWorkflowActionButtonEnabled({ transfer: { enabled: true } }, 'transfer')).toBe(true);
    expect(isWorkflowActionButtonEnabled({ approve: { enabled: false } }, 'approve')).toBe(false);
  });
});
