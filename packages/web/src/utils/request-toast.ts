import { Toast } from '@douyinfe/semi-ui';

type RequestToastType = 'error' | 'warning';

const REQUEST_TOAST_DURATION = 4;

let activeToastId: string | null = null;
let lastToastKey = '';

function showRequestToast(type: RequestToastType, content: string): void {
  const key = `${type}:${content}`;

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
    content,
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

export function showRequestErrorToast(content: string): void {
  showRequestToast('error', content);
}

export function showRequestWarningToast(content: string): void {
  showRequestToast('warning', content);
}
