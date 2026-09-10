import { apiJson, isOk } from './shared/api';

interface CaptchaChallenge {
  id: string;
  svg: string;
}

/**
 * 图形验证码（`.cms-captcha-box`：input[name=captchaId] + .cms-captcha-img）：
 * 挂载即拉取算术题 SVG 填入，点击图片刷新。SVG 由服务端生成，属可信内容。
 */
export function mountCaptcha(el: HTMLElement): void {
  const idInput = el.querySelector<HTMLInputElement>('input[name="captchaId"]');
  const image = el.querySelector<HTMLElement>('.cms-captcha-img');
  const load = () => {
    apiJson<CaptchaChallenge>('/api/public/cms/captcha')
      .then((result) => {
        if (!isOk(result)) return;
        if (idInput) idInput.value = result.data.id;
        if (image) {
          image.innerHTML = result.data.svg;
          image.title = '看不清？点击刷新';
        }
      })
      .catch(() => {});
  };
  load();
  image?.addEventListener('click', load);
}
