/** Directory-upload paths are relative browser paths, never host filesystem paths. */
export function collectDriveUploadDirectories(paths: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return [...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

export function driveUploadParentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}
