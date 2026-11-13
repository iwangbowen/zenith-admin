import { describe, expect, it } from 'vitest';
import {
  sanitizeImportedPreferences,
} from './usePreferences';

describe('loading style preference', () => {
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
  it('accepts known sound styles and rejects unknown ones when importing preferences', () => {
    expect(sanitizeImportedPreferences({ notificationSound: false, notificationSoundStyle: 'pop' })).toEqual({
      notificationSound: false,
      notificationSoundStyle: 'pop',
    });
    expect(sanitizeImportedPreferences({ notificationSoundStyle: 'siren' })).toBeNull();
  });
});

describe('display & behaviour preferences', () => {
  it('accepts known enum values and rejects unknown ones when importing preferences', () => {
    expect(sanitizeImportedPreferences({ uiScale: 110, fontFamily: 'mono', timeDisplay: 'relative', weekStart: 'sunday' })).toEqual({
      uiScale: 110,
      fontFamily: 'mono',
      timeDisplay: 'relative',
      weekStart: 'sunday',
    });
    expect(sanitizeImportedPreferences({ uiScale: 95 })).toBeNull();
    expect(sanitizeImportedPreferences({ fontFamily: 'comic-sans' })).toBeNull();
    expect(sanitizeImportedPreferences({ timeDisplay: 'iso' })).toBeNull();
    expect(sanitizeImportedPreferences({ weekStart: 'saturday' })).toBeNull();
  });
});
