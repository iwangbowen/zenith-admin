import { describe, expect, it } from 'vitest';
import {
  buildBreadcrumbs,
  getFileMimeType,
  isArchive,
  isEditableFile,
  joinPath,
  makeCopyName,
  modeToOctal,
  modeToSymbolic,
  octalToMode,
  permStringToOctal,
  updateUploadPct,
  validateEntryName,
} from './fs-utils';

describe('joinPath', () => {
  it('joins POSIX paths and strips trailing separators', () => {
    expect(joinPath('/var/log/', 'app.log')).toBe('/var/log/app.log');
    expect(joinPath('/', 'etc')).toBe('/etc');
  });

  it('detects Windows separator from the directory', () => {
    expect(joinPath('C:\\Users\\', 'a.txt')).toBe('C:\\Users\\a.txt');
  });
});

describe('makeCopyName', () => {
  it('keeps the extension and appends 副本 suffix', () => {
    expect(makeCopyName('a.txt', new Set())).toBe('a - 副本.txt');
  });

  it('increments until the name is free (case-insensitive)', () => {
    const taken = new Set(['a - 副本.txt', 'a - 副本 2.txt']);
    expect(makeCopyName('a.txt', taken)).toBe('a - 副本 3.txt');
  });

  it('treats dotfiles as extensionless', () => {
    expect(makeCopyName('.env', new Set())).toBe('.env - 副本');
  });
});

describe('validateEntryName', () => {
  it('rejects empty and separator-containing names on any platform', () => {
    expect(validateEntryName('  ', false)).not.toBeNull();
    expect(validateEntryName('a/b', false)).not.toBeNull();
    expect(validateEntryName('a\\b', false)).not.toBeNull();
    expect(validateEntryName('..', false)).not.toBeNull();
  });

  it('accepts a normal name', () => {
    expect(validateEntryName('report-2026.txt', true)).toBeNull();
  });

  it('enforces Windows-specific rules only when isWindows', () => {
    expect(validateEntryName('a:b', true)).not.toBeNull();
    expect(validateEntryName('a:b', false)).toBeNull();
    expect(validateEntryName('name.', true)).not.toBeNull();
    expect(validateEntryName('CON.txt', true)).not.toBeNull();
    expect(validateEntryName('CON.txt', false)).toBeNull();
  });
});

describe('buildBreadcrumbs', () => {
  it('returns root crumb for empty or /', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: '/', path: '/' }]);
    expect(buildBreadcrumbs('')).toEqual([{ label: '/', path: '/' }]);
  });

  it('builds cumulative POSIX paths with a leading root', () => {
    expect(buildBreadcrumbs('/var/log')).toEqual([
      { label: '/', path: '/' },
      { label: 'var', path: '/var' },
      { label: 'log', path: '/var/log' },
    ]);
  });

  it('keeps the drive-root trailing backslash on Windows', () => {
    expect(buildBreadcrumbs('C:\\Users\\me')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'me', path: 'C:\\Users\\me' },
    ]);
  });
});

describe('permission conversions', () => {
  it('round-trips octal ↔ numeric mode', () => {
    expect(modeToOctal(0o755)).toBe('755');
    expect(octalToMode('644')).toBe(0o644);
    expect(octalToMode('not-octal')).toBe(0);
  });

  it('renders symbolic form', () => {
    expect(modeToSymbolic(0o755)).toBe('rwxr-xr-x');
    expect(modeToSymbolic(0o600)).toBe('rw-------');
  });

  it('parses ls-style permission strings, ignoring the type prefix', () => {
    expect(permStringToOctal('drwxr-xr-x')).toBe('755');
    expect(permStringToOctal('-rw-r--r--')).toBe('644');
    expect(permStringToOctal(undefined)).toBe('');
  });
});

describe('file classification', () => {
  it('flags editable text files, extensionless and dotfiles', () => {
    expect(isEditableFile('readme.md')).toBe(true);
    expect(isEditableFile('Dockerfile')).toBe(true);
    expect(isEditableFile('.env')).toBe(true);
    expect(isEditableFile('photo.png')).toBe(false);
  });

  it('detects archives case-insensitively', () => {
    expect(isArchive('bundle.tar.gz')).toBe(true);
    expect(isArchive('DATA.ZIP')).toBe(true);
    expect(isArchive('notes.txt')).toBe(false);
  });

  it('maps extensions to mime types with null fallback', () => {
    expect(getFileMimeType('doc.PDF')).toBe('application/pdf');
    expect(getFileMimeType('slides.PPT')).toBe('application/vnd.ms-powerpoint');
    expect(getFileMimeType('slides.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(getFileMimeType('slides.ppsm')).toBe('application/vnd.ms-powerpoint.slideshow.macroenabled.12');
    expect(getFileMimeType('report.xlsb')).toBe('application/vnd.ms-excel.sheet.binary.macroenabled.12');
    expect(getFileMimeType('document.odt')).toBe('application/vnd.oasis.opendocument.text');
    expect(getFileMimeType('invoice.ofd')).toBe('application/ofd');
    expect(getFileMimeType('mail.eml')).toBe('message/rfc822');
    expect(getFileMimeType('outlook.msg')).toBe('application/vnd.ms-outlook');
    expect(getFileMimeType('archive.mbox')).toBe('application/mbox');
    expect(getFileMimeType('brainstorm.xmind')).toBe('application/vnd.xmind.workbook');
    expect(getFileMimeType('architecture.mermaid')).toBe('text/x-mermaid');
    expect(getFileMimeType('flow.MMD')).toBe('text/x-mermaid');
    expect(getFileMimeType('backup.7z')).toBe('application/x-7z-compressed');
    expect(getFileMimeType('package.tar.gz')).toBe('application/gzip');
    expect(getFileMimeType('unknown.xyz')).toBeNull();
  });
});

describe('misc helpers', () => {
  it('updates only the targeted upload progress entry', () => {
    const prev = [{ name: 'a', progress: 0 }, { name: 'b', progress: 10 }];
    const next = updateUploadPct(prev, 1, 50);
    expect(next[0]).toEqual({ name: 'a', progress: 0 });
    expect(next[1]).toEqual({ name: 'b', progress: 50 });
    expect(prev[1].progress).toBe(10);
  });
});
