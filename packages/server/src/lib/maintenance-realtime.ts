import type { JwtPayload } from '../middleware/auth';
import { getMaintenanceStatus } from '../services/ops/maintenance.service';
import { maintenanceAccess } from './maintenance-access';
import { getTokenRevocation } from './session-manager';
import { checkAdminJwtSubject } from '../middleware/auth';
export async function maintenanceRealtimeAllowed(user: JwtPayload): Promise<boolean> {
  try {
    if (!(await getMaintenanceStatus()).enabled) return true;
    if (!(await checkAdminJwtSubject(user)).ok || (user.jti && await getTokenRevocation(user.jti))) return false;
    return (await maintenanceAccess(user)).canBypass;
  } catch { return false; }
}
