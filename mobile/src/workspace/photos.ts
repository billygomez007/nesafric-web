import * as ImagePicker from "expo-image-picker";

import type { PhotoUpload } from "@/api/workspace-actions";

/**
 * Largest photo the upload endpoint accepts (same limit as the website): photos travel base64 in
 * JSON and the hosting platform rejects request bodies over 4.5 MB before the API runs.
 */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export type PickedPhoto = PhotoUpload & { uri: string; key: string };
export type PhotoPick = { photos: PickedPhoto[]; rejected: string[] };

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Bytes a base64 string decodes to. */
export function decodedSize(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Turns picker results into uploads, naming each photo that can't be sent and why. */
export function toPhotoUploads(assets: ImagePicker.ImagePickerAsset[]): PhotoPick {
  const photos: PickedPhoto[] = [];
  const rejected: string[] = [];
  assets.forEach((asset, index) => {
    const name = asset.fileName ?? `photo-${index + 1}.jpg`;
    const contentType = asset.mimeType ?? "image/jpeg";
    if (!asset.base64) rejected.push(`${name} couldn't be read.`);
    else if (!ACCEPTED.has(contentType)) rejected.push(`${name} isn't a JPEG, PNG or WebP photo.`);
    else if (decodedSize(asset.base64) > MAX_PHOTO_BYTES) rejected.push(`${name} is larger than 3 MB.`);
    else photos.push({ fileName: name, contentType, dataBase64: asset.base64, uri: asset.uri, key: `${asset.assetId ?? asset.uri}:${index}` });
  });
  return { photos, rejected };
}

/** Opens the photo library for up to `limit` photos, compressed on the device before upload. */
export async function pickListingPhotos(limit: number): Promise<PhotoPick> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.6,
    base64: true,
    exif: false,
  });
  if (result.canceled) return { photos: [], rejected: [] };
  return toPhotoUploads(result.assets.slice(0, limit));
}
