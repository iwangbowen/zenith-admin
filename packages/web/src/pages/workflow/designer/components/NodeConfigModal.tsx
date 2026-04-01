/**
 * 节点配置弹窗 — 根据节点类型渲染不同的配置表单
 */
import { useRef, useEffect } from 'react';
import { Form, Modal, Select } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { FlowNode } from '../types';
import { ADDABLE_NODE_TYPES } from '../constants';

interface UserOption { id: number; nickname: string; }

interface NodeConfigModalProps {
  visible: boolean;
  node: FlowNode | null;
  users: UserOption[];
  onSave: (nodeId: string, updates: { name?: string; props?: Record<string, unknown> }) => void;
  onCancel: () => void;
}

export default function NodeConfigModal({
  visible,
  node,
  users,
  onSave,
  onCancel,
}: Readonly<NodeConfigModalProps>) {
  const formApiRef = useRef<FormApi | null>(null);

  const nodeInfo = node ? ADDABLE_NODE_TYPES.find(n => n.type === node.type) : null;
  const title = node?.type === 'initiator'
    ? '设置发起人'
    : `编辑${nodeInfo?.label ?? '节点'}`;

  useEffect(() => {
    if (visible && node) {
      // 设置 form 初始值: 延迟到下一tick等 form mount
      setTimeout(() => {
        formApiRef.current?.setValues({
          name: node.name,
          ...node.props,
        });
      }, 0);
    }
  }, [visible, node]);

  const handleOk = () => {
    formApiRef.current?.validate()
      .then((values: Record<string, unknown>) => {
        if (!node) return;
        const { name, ...rest } = values;
        onSave(node.id, {
          name: name as string,
          props: rest,
        });
      })
      .catch(() => undefined);
  };

  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onCancel}
      onOk={handleOk}
      style={{ width: 500 }}
    >
      <Form getFormApi={api => { formApiRef.current = api; }}>
        {/* 通用: 节点名称 */}
        <Form.Input
          field="name"
          label="节点名称"
          rules={[{ required: true, message: '请输入节点名称' }]}
        />

        {/* 发起人 */}
        {node?.type === 'initiator' && (
          <Form.TextArea
            field="initiatorDesc"
            label="发起人范围说明"
            placeholder="如：所有人 / 指定部门"
          />
        )}

        {/* 审批人 */}
        {node?.type === 'approver' && (
          <>
            <Form.Select
              field="assigneeId"
              label="审批人"
              placeholder="请选择审批人"
              optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
              showClear
              filter
            />
            <Form.Select
              field="approveType"
              label="审批方式"
              initValue="single"
              optionList={[
                { value: 'single', label: '或签（一人通过即可）' },
                { value: 'all', label: '会签（所有人通过）' },
                { value: 'sequential', label: '依次审批' },
              ]}
            />
          </>
        )}

        {/* 办理人 */}
        {node?.type === 'handler' && (
          <Form.Select
            field="assigneeId"
            label="办理人"
            placeholder="请选择办理人"
            optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
            showClear
            filter
          />
        )}

        {/* 抄送 */}
        {node?.type === 'cc' && (
          <Form.Select
            field="assigneeIds"
            label="抄送人"
            placeholder="请选择抄送人（可多选）"
            optionList={users.map(u => ({ value: u.id, label: u.nickname }))}
            multiple
            filter
          />
        )}

        {/* 延迟器 */}
        {node?.type === 'delay' && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <Form.Slot label="延迟时间">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Form.InputNumber field="delayValue" min={1} initValue={1} style={{ width: 100 }} />
                <Select
                  defaultValue="hour"
                  optionList={[
                    { value: 'minute', label: '分钟' },
                    { value: 'hour', label: '小时' },
                    { value: 'day', label: '天' },
                  ]}
                  style={{ width: 100 }}
                  onChange={v => formApiRef.current?.setValue('delayUnit', v)}
                />
              </div>
            </Form.Slot>
          </div>
        )}

        {/* 触发器 */}
        {node?.type === 'trigger' && (
          <Form.Input
            field="triggerEvent"
            label="触发事件"
            placeholder="如：webhook_received"
          />
        )}

        {/* 子流程 */}
        {node?.type === 'subProcess' && (
          <Form.Input
            field="subProcessId"
            label="子流程 ID"
            placeholder="请输入关联的流程定义 ID"
          />
        )}
      </Form>
    </Modal>
  );
}
