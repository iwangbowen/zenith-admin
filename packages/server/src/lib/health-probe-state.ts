let applicationStartupReady = false;

/** True only after the complete background declaration phase has succeeded. */
export function isApplicationStartupReady(): boolean {
  return applicationStartupReady;
}

/** Called by the process bootstrap after all registries are declared and sealed. */
export function markApplicationStartupReady(): void {
  applicationStartupReady = true;
}
