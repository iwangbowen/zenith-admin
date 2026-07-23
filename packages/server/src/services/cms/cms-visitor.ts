import { createHash } from 'node:crypto';
import { config } from '../../config';

function digest(scope: string, value: string): string {
  return createHash('sha256')
    .update(`${config.jwtSecret}\0${scope}\0${value}`)
    .digest('hex');
}

export function hashCmsIp(ip: string | null | undefined): string {
  return digest('cms-ip', ip?.trim() || 'unknown');
}

export function hashCmsVisitor(ip: string | null | undefined, userAgent: string | null | undefined): string {
  return digest('cms-visitor', `${ip?.trim() || 'unknown'}\0${userAgent?.slice(0, 500) ?? ''}`);
}

export function hashCmsRequestKey(value: string): string {
  return digest('cms-request', value.trim());
}

export function maskCmsHash(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}
