import { SEED_API_SCOPES } from '@zenith/shared';
import type { ApiScope } from '@zenith/shared';

export const mockApiScopes: ApiScope[] = SEED_API_SCOPES.map((s) => ({ ...s }));
