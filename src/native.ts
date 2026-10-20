import { Capacitor } from '@capacitor/core';

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The stitched image could not be prepared for sharing.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The stitched image could not be read.'));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Opens the native iOS share sheet for a lossless PNG.
 * Returns false in browsers so the caller can use Web Share or a download.
 * A cancelled native share is handled normally; other failures are surfaced.
 */
export async function shareImage(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const safeName = filename.replace(/\.png$/i, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'tailorstitch';
  const path = `tailorstitch-exports/${Date.now()}-${safeName}.png`;
  const { uri } = await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: await readBase64(blob),
    recursive: true,
  });

  try {
    await Share.share({
      title: 'TailorStitch',
      files: [uri],
      dialogTitle: 'Save or share your stitched image',
    });
  } catch (error) {
    // The native plugin rejects when the user dismisses the share sheet.
    if (!(error instanceof Error && /cancel/i.test(error.message))) throw error;
  } finally {
    // Share resolves after the activity finishes. Never retain screenshot exports.
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
  return true;
}
