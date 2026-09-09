import { describe, expect, it } from 'vitest';
import {
  defaultPreferences,
  sanitizeImportedPreferences,
} from './usePreferences';

describe('loading style preference', () => {
  it('uses the flip animation as the default', () => {
    expect(defaultPreferences.loadingStyle).toBe('flip');
  });

  it('accepts known loading styles when importing preferences', () => {
    expect(sanitizeImportedPreferences({ loadingStyle: 'dots' })).toEqual({
      loadingStyle: 'dots',
    });
  });

  it('rejects unknown loading styles when importing preferences', () => {
    expect(sanitizeImportedPreferences({ loadingStyle: 'unknown' })).toBeNull();
  });
});

describe('dark surface tone preference', () => {
  it('defaults every region to the bg-1 tone', () => {
    expect(defaultPreferences.darkSidebarTone).toBe('bg-1');
    expect(defaultPreferences.darkHeaderTone).toBe('bg-1');
    expect(defaultPreferences.darkContentTone).toBe('bg-1');
  });

  it('accepts known tones for each region when importing preferences', () => {
    expect(sanitizeImportedPreferences({
      darkSidebarTone: 'bg-0',
      darkHeaderTone: 'bg-1',
      darkContentTone: 'bg-0',
    })).toEqual({
      darkSidebarTone: 'bg-0',
      darkHeaderTone: 'bg-1',
      darkContentTone: 'bg-0',
    });
  });

  it('rejects unknown tones when importing preferences', () => {
    expect(sanitizeImportedPreferences({ darkContentTone: 'bg-2' })).toBeNull();
  });
});

describe('notification sound preference', () => {
  it('plays the chime by default', () => {
    expect(defaultPreferences.notificationSound).toBe(true);
    expect(defaultPreferences.notificationSoundStyle).toBe('chime');
  });

  it('accepts known sound styles and rejects unknown ones when importing preferences', () => {
    expect(sanitizeImportedPreferences({ notificationSound: false, notificationSoundStyle: 'pop' })).toEqual({
      notificationSound: false,
      notificationSoundStyle: 'pop',
    });
    expect(sanitizeImportedPreferences({ notificationSoundStyle: 'siren' })).toBeNull();
  });
});
