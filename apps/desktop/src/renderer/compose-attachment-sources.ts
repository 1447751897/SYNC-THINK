export interface ComposeAttachmentByteSource {
  name: string;
  mimeType?: string;
  bytes: Uint8Array;
}

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

export async function serializeComposeFiles(
  files: readonly File[],
): Promise<ComposeAttachmentByteSource[]> {
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
  }
  return Promise.all(
    files.map(async (file) => {
      const image = isImageFile(file);
      const limit = image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (file.size > limit) {
        throw new Error(`${file.name} 超过 ${image ? '20 MB' : '50 MB'} 限制`);
      }
      return {
        name: file.name,
        ...(file.type ? { mimeType: file.type } : {}),
        bytes: new Uint8Array(await file.arrayBuffer()),
      };
    }),
  );
}
