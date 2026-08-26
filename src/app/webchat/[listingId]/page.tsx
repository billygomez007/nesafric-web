import { WebChatWidget } from "@/components/web-chat-widget";

export default async function ListingWebChatPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  return <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
    <WebChatWidget listingId={listingId} />
  </main>;
}
