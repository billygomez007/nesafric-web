export type SelectedListingImage = {
  file: File;
  previewUrl: string;
};

export const MAX_LISTING_IMAGES = 12;

export const ACCEPTED_LISTING_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_LISTING_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateListingImage(file: File) {
  if (
    !ACCEPTED_LISTING_IMAGE_TYPES.includes(
      file.type as (typeof ACCEPTED_LISTING_IMAGE_TYPES)[number],
    )
  ) {
    throw new Error(
      `${file.name}: only JPG, PNG and WebP images are supported.`,
    );
  }

  if (file.size > MAX_LISTING_IMAGE_BYTES) {
    throw new Error(
      `${file.name}: image must be 10MB or smaller.`,
    );
  }
}

export function filesToSelectedImages(
  files: File[],
): SelectedListingImage[] {
  return files.map((file) => {
    validateListingImage(file);

    return {
      file,
      previewUrl: URL.createObjectURL(file),
    };
  });
}

export function releaseSelectedImage(
  image: SelectedListingImage,
) {
  URL.revokeObjectURL(image.previewUrl);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () =>
      reject(new Error(`Unable to read ${file.name}.`));

    reader.onload = () => {
      const value = String(reader.result ?? "");
      const separator = value.indexOf(",");

      if (separator < 0) {
        reject(new Error(`Unable to encode ${file.name}.`));
        return;
      }

      resolve(value.slice(separator + 1));
    };

    reader.readAsDataURL(file);
  });
}

export async function uploadListingImages(params: {
  listingId: string;
  organisationId: string;
  title: string;
  images: SelectedListingImage[];
}) {
  for (
    let index = 0;
    index < params.images.length;
    index += 1
  ) {
    const image = params.images[index];
    const dataBase64 = await fileToBase64(image.file);

    const response = await fetch("/api/documents/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organisation-id": params.organisationId,
      },
      body: JSON.stringify({
        targetType: "LISTING_MEDIA",
        targetId: params.listingId,
        fileName: image.file.name,
        contentType: image.file.type,
        dataBase64,
        classification: "PUBLIC",
        mediaType: "PHOTO",
        title:
          index === 0
            ? "Cover photo"
            : `Property photo ${index + 1}`,
        altText: `${params.title} — property photo ${index + 1}`,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error?.message ??
          `Unable to upload ${image.file.name}.`,
      );
    }
  }
}
