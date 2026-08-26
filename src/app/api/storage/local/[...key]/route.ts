import { NextResponse } from "next/server";
import { db } from "@/platform/database/client";
import { getObjectStorageAdapter, verifyLocalObjectToken } from "@/platform/storage";

/**
 * Serves bytes for the local/in-memory adapter's signed-URL scheme (item 1). Authorisation comes
 * entirely from the HMAC token + expiry embedded in the URL (verified here), not from a session —
 * this route is unauthenticated by design, exactly like an S3 presigned URL would be. It is never
 * used when a real S3-compatible provider is configured (that adapter returns a genuine presigned
 * URL directly to the bucket instead).
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const expires = Number(url.searchParams.get("expires"));
  if (!token || !expires) return new NextResponse("Missing signature", { status: 403 });
  const verification = verifyLocalObjectToken(key, token, expires);
  if (!verification.verified) return new NextResponse("Invalid or expired link", { status: 403 });
  const storageObject = await db.storageObject.findUnique({ where: { storageKey: key } });
  if (!storageObject || storageObject.archivedAt) return new NextResponse("Not found", { status: 404 });
  const object = await getObjectStorageAdapter().getObject(key);
  if (!object) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "content-type": object.contentType,
      "content-disposition": `attachment; filename="${storageObject.safeFileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
