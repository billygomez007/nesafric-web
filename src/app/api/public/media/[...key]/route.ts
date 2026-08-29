import { NextResponse } from "next/server";
import { db } from "@/platform/database/client";
import { getObjectStorageAdapter } from "@/platform/storage";

/**
 * Unauthenticated public media streaming (item 1: "explicit public marketplace media"). Serves
 * bytes only for `StorageObject` rows explicitly marked PUBLIC and not archived — this is the
 * fallback "public URL" used when the active adapter cannot produce a durable public URL itself
 * (e.g. the local/in-memory dev adapters); an S3-compatible adapter with a public bucket/CDN
 * configured returns its own direct URL instead and never reaches this route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  const storageObject = await db.storageObject.findUnique({ where: { storageKey: key } });
  if (!storageObject || storageObject.archivedAt || storageObject.classification !== "PUBLIC") {
    return new NextResponse("Not found", { status: 404 });
  }
  let object;
  try {
    object = await getObjectStorageAdapter().getObject(key);
  } catch {
    return new NextResponse("Storage temporarily unavailable", { status: 503 });
  }
  if (!object) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(object.body), {
    headers: { "content-type": object.contentType, "cache-control": "public, max-age=3600" },
  });
}
