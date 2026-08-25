interface FileDeleter {
  deleteFileByUrl(url: string): Promise<unknown>;
}

export const hasValidSupportedImageSignature = (
  file: Express.Multer.File,
): boolean => {
  const bytes = file.buffer;
  if (!bytes || bytes.length < 12) return false;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isWebp =
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return isJpeg || isPng || isWebp;
};

export const deleteFilesBestEffort = async (
  deleter: FileDeleter,
  urls: Array<string | null | undefined>,
  attempts = 2,
): Promise<string[]> => {
  let pending = [...new Set(urls.filter((url): url is string => Boolean(url)))];
  for (
    let attempt = 0;
    attempt < attempts && pending.length > 0;
    attempt += 1
  ) {
    const results = await Promise.allSettled(
      pending.map((url) => deleter.deleteFileByUrl(url)),
    );
    pending = pending.filter(
      (_, index) => results[index].status === 'rejected',
    );
  }
  return pending;
};
