/**
 * The professional's chosen cover photo first, then the rest in gallery order. The server keeps
 * the cover at the front already; reading `isCover` explicitly means no surface silently shows
 * a different "first" photo if that ever drifts.
 */
export function photosCoverFirst<T extends { type: string; isCover?: boolean }>(media: T[]): T[] {
  const photos = media.filter((item) => item.type === "PHOTO");
  const cover = photos.find((item) => item.isCover);
  return cover ? [cover, ...photos.filter((item) => item !== cover)] : photos;
}
