import { describe, it, expect } from 'vitest';
import logger from './logger';

describe('logger', () => {
  it('should be defined', () => {
    expect(logger).toBeDefined();
  });

  it('should have an info method', () => {
    expect(typeof logger.info).toBe('function');
  });

  it('should have an error method', () => {
    expect(typeof logger.error).toBe('function');
  });

  it('should have a warn method', () => {
    expect(typeof logger.warn).toBe('function');
  });

  it('should have a debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });

  it('should have a verbose method', () => {
    expect(typeof logger.verbose).toBe('function');
  });

  it('should not throw when logging info', () => {
    expect(() => logger.info('Test info message')).not.toThrow();
  });

  it('should not throw when logging error', () => {
    expect(() => logger.error('Test error message')).not.toThrow();
  });

  it('should not throw when logging warn', () => {
    expect(() => logger.warn('Test warn message')).not.toThrow();
  });

  it('should not throw when logging debug', () => {
    expect(() => logger.debug('Test debug message')).not.toThrow();
  });
});
