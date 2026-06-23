import type { MpMenu } from '@zenith/shared';
import { SEED_MP_MENUS } from '@zenith/shared';

export const mockMpMenus: MpMenu[] = SEED_MP_MENUS.map((m) => ({ ...m, buttons: JSON.parse(JSON.stringify(m.buttons)) }));
