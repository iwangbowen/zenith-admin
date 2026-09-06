import { fireEvent, render, screen } from '@testing-library/react';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RuleVersionHistorySheet } from './RuleVersionHistorySheet';

const confirmCalls = vi.hoisted(() => [] as ModalReactProps[]);
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  Object.assign(actual.Modal, { confirm: (config: ModalReactProps) => { confirmCalls.push(config); return { destroy() {}, update() {} }; } });
  return actual;
});

beforeEach(() => { confirmCalls.length = 0; });

describe('RuleVersionHistorySheet', () => {
  it('renders versions and preserves rollback confirmation text', async () => {
    const onRollback = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <RuleVersionHistorySheet
        visible
        titleName="风控评分卡"
        versions={[{ version: 3, publishedAt: '2026-01-01 10:00:00' }]}
        canRollback
        versionOf={(v) => v.version}
        publishedAtOf={(v) => v.publishedAt}
        onClose={onClose}
        onRollback={onRollback}
      />,
    );
    expect(screen.getByText('v3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('回滚'));
    expect(confirmCalls[0]).toMatchObject({
      title: '回滚到 v3？',
      content: '历史快照将覆盖当前编辑态并置为草稿；线上继续运行既有发布，重新发布后生效',
    });
    await confirmCalls[0].onOk?.({} as never);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
