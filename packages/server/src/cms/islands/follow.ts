import { apiHeaders, apiJson, isOk } from './shared/api';
import { goToMemberLogin, readMemberToken } from './shared/member';

interface SubscriptionRow {
  id: number;
}

interface SubscriptionBody {
  siteId: number;
  subjectType: string;
  subjectId?: number;
  subjectKey?: string;
  notificationEnabled: boolean;
}

function subscriptionBody(el: HTMLElement): SubscriptionBody {
  const body: SubscriptionBody = {
    siteId: Number(el.dataset.site),
    subjectType: el.dataset.subjectType ?? '',
    notificationEnabled: true,
  };
  if (el.dataset.subjectId) body.subjectId = Number(el.dataset.subjectId);
  if (el.dataset.subjectKey) body.subjectKey = el.dataset.subjectKey;
  return body;
}

function paint(el: HTMLElement, row: SubscriptionRow | null | undefined): void {
  el.dataset.subscriptionId = row ? String(row.id) : '';
  el.setAttribute('aria-pressed', row ? 'true' : 'false');
  el.textContent = row ? '已关注' : '关注';
}

/**
 * 关注 / 订阅按钮（`.cms-follow`，容器契约：data-site / data-subject-type / data-subject-id / data-subject-key）。
 * 未登录：文案改为「登录后关注」，点击跳会员端；已登录：拉取订阅状态，点击在 POST / DELETE 间切换。
 */
export function mountFollow(el: HTMLElement): void {
  const button = el as HTMLButtonElement;
  const token = readMemberToken();
  if (!token) {
    button.textContent = '登录后关注';
    button.addEventListener('click', goToMemberLogin);
    return;
  }
  const body = subscriptionBody(button);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value != null) query.set(key, String(value));
  }
  apiJson<SubscriptionRow | null>(`/api/member/cms/subscriptions/status?${query.toString()}`, { headers: apiHeaders(token, false) })
    .then((result) => { if (isOk(result)) paint(button, result.data); })
    .catch(() => {});

  button.addEventListener('click', () => {
    button.disabled = true;
    const id = Number(button.dataset.subscriptionId) || 0;
    const request = id
      ? apiJson<SubscriptionRow>(`/api/member/cms/subscriptions/${id}`, { method: 'DELETE', headers: apiHeaders(token, false) })
      : apiJson<SubscriptionRow>('/api/member/cms/subscriptions', {
        method: 'POST',
        headers: { ...apiHeaders(token, true), 'X-Idempotency-Key': `follow-${Date.now()}` },
        body: JSON.stringify(body),
      });
    request
      .then((result) => {
        if (!isOk(result)) {
          alert(result?.message || '操作失败');
          return;
        }
        paint(button, id ? null : result.data);
      })
      .catch(() => alert('操作失败，请稍后重试'))
      .finally(() => { button.disabled = false; });
  });
}
