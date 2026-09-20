import { createContext } from 'react';
import type { CanonicalEntityRef } from '@zenith/shared/platform';

/** One sheet owns navigation history so following relations does not stack drawers. */
export const EntityNavigationContext = createContext<((ref: CanonicalEntityRef) => void) | null>(null);
