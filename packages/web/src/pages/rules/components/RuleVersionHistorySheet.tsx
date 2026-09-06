import { Button, List, Modal, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';

const { Text } = Typography;

export interface RuleVersionHistorySheetProps<TVersion> {
  titleName?: string;
  visible: boolean;
  versions: TVersion[];
  loading?: boolean;
  canRollback: boolean;
  versionOf: (version: TVersion) => number;
  publishedAtOf: (version: TVersion) => string;
  onClose: () => void;
  onRollback: (version: TVersion) => Promise<unknown>;
  width?: number;
}

export function RuleVersionHistorySheet<TVersion>({
  titleName,
  visible,
  versions,
  loading,
  canRollback,
  versionOf,
  publishedAtOf,
  onClose,
  onRollback,
  width = 420,
}: RuleVersionHistorySheetProps<TVersion>) {
  return (
    <SideSheet title={titleName ? `版本历史 · ${titleName}` : '版本历史'} visible={visible} onCancel={onClose} width={width}>
      <List
        loading={loading}
        dataSource={versions}
        emptyContent="暂无发布版本"
        renderItem={(version) => {
          const versionNumber = versionOf(version);
          return (
            <List.Item
              main={(
                <Space spacing={8} wrap>
                  <Tag size="small" color="blue">v{versionNumber}</Tag>
                  <Text type="tertiary" size="small">{publishedAtOf(version)}</Text>
                </Space>
              )}
              extra={canRollback ? (
                <Button
                  size="small"
                  loading={loading}
                  onClick={() => {
                    Modal.confirm({
                      title: `回滚到 v${versionNumber}？`,
                      content: '历史快照将覆盖当前编辑态并置为草稿；线上继续运行既有发布，重新发布后生效',
                      onOk: async () => {
                        await onRollback(version);
                        Toast.success('回滚成功');
                        onClose();
                      },
                    });
                  }}
                >
                  回滚
                </Button>
              ) : undefined}
            />
          );
        }}
      />
    </SideSheet>
  );
}
