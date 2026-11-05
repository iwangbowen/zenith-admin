import { Toast, Typography } from '@douyinfe/semi-ui';

type RequestToastType = 'error' | 'warning';

const REQUEST_TOAST_DURATION = 4;

let activeToastId: string | null = null;
let lastToastKey = '';

function showRequestToast(type: RequestToastType, content: string, correlationId?: string | null): void {
  const key = `${type}:${content}:${correlationId ?? ''}`;

  // 同内容且 toast 仍可见：直接丢弃，避免高频同错误下反复关旧开新造成闪烁
  if (activeToastId && key === lastToastKey) {
    return;
  }

  if (activeToastId) {
    Toast.close(activeToastId);
    activeToastId = null;
  }

  lastToastKey = key;

  let toastId = '';
  const options = {
    // 服务端错误附链路 ID（可复制），用户报障时一键提供给管理员按链路排查
    content: correlationId
      ? (
          <span>
            {content}
            <Typography.Text
              size="small"
              type="tertiary"
              copyable={{ content: correlationId }}
              style={{ display: 'block', marginTop: 2 }}
            >
              关联 ID: {correlationId.slice(0, 8)}…
            </Typography.Text>
          </span>
        )
      : content,
    duration: REQUEST_TOAST_DURATION,
    onClose: () => {
      if (activeToastId === toastId) {
        activeToastId = null;
      }
    },
  };

  toastId = type === 'error' ? Toast.error(options) : Toast.warning(options);
  activeToastId = toastId;
}

export function showRequestErrorToast(content: string, correlationId?: string | null): void {
  showRequestToast('error', content, correlationId);
}

export function showRequestWarningToast(content: string): void {
  showRequestToast('warning', content);
}
