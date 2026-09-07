export interface DirectoryUploadFile {
  file: File;
  relativePath: string;
}

export async function collectDroppedDirectory(data: DataTransfer): Promise<{ files: DirectoryUploadFile[]; directories: string[] }> {
  const files: DirectoryUploadFile[] = [];
  const directories: string[] = [];
  const visit = async (entry: FileSystemEntry, prefix: string) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push({ file, relativePath: path });
    } else if (entry.isDirectory) {
      directories.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, path);
      }
    }
  };
  const entries = Array.from(data.items).filter((item) => item.kind === 'file').map((item) => ({
    entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile(),
  }));
  for (const item of entries) {
    if (item.entry) await visit(item.entry, '');
    else if (item.file) files.push({ file: item.file, relativePath: item.file.name });
  }
  return { files, directories };
}
