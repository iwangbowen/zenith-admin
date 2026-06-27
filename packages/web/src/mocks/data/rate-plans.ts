import { SEED_RATE_PLANS } from '@zenith/shared';
import type { RatePlan } from '@zenith/shared';

export const mockRatePlans: RatePlan[] = SEED_RATE_PLANS.map((p) => ({ ...p }));
