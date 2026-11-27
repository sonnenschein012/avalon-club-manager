import { Bytes } from 'firebase/firestore';
import { maxExhibitionImageBytes } from '../src/domain/exhibition/presentation';

export async function preparePinImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 16 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG, or WebP file under 16 MB.');
  }
  const source = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    for (const size of [512, 384, 256]) {
      const scale = Math.min(1, size / Math.max(source.width, source.height));
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .9));
      if (blob?.type === 'image/webp' && blob.size <= maxExhibitionImageBytes) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { version: 'upload:' + crypto.randomUUID(), bytes,
          preview: 'data:image/webp;base64,' + Bytes.fromUint8Array(bytes).toBase64() };
      }
    }
    throw new Error('This image could not be resized for the exhibit.');
  } finally { source.close(); }
}

export type PreparedPinImage = Awaited<ReturnType<typeof preparePinImage>>;
