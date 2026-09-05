import { mpSecurityContract } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';

const RISKY_WORDS = ['违规', '赌博', '诈骗', '色情', '暴力'];

export const mpSecurityHandlers = [
  mock(mpSecurityContract.checkText, ({ body, ok }) => {
    const risky = RISKY_WORDS.some((w) => body.content.includes(w));
    return ok({ pass: !risky, suggest: risky ? 'risky' : 'pass' });
  }),
];
