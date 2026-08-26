"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = { id: string; direction: "INBOUND" | "OUTBOUND"; senderType: string; body: string; createdAt: string };
type ChatState = { conversationId: string; chatToken: string; messages: ChatMessage[] };

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  return body.error?.message ?? "Something went wrong. Please try again.";
}

/**
 * Embeddable property marketplace web chat. Works for anonymous prospects
 * (no listingId/propertyId auth required) and continues to poll for AI
 * receptionist or human takeover replies.
 */
export function WebChatWidget({ listingId, propertyId }: { listingId?: string; propertyId?: string }) {
  const [chat, setChat] = useState<ChatState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  function startPolling(conversationId: string, chatToken: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const response = await fetch(`/api/public/webchat/conversations/${conversationId}?chatToken=${encodeURIComponent(chatToken)}`);
      if (!response.ok) return;
      const body = await response.json();
      setChat({ conversationId, chatToken, messages: body.messages });
    }, 4000);
  }

  async function start() {
    setError("");
    try {
      const response = await fetch("/api/public/webchat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, propertyId, visitorName: name || undefined, visitorEmail: email || undefined, message }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json() as { conversationId: string; chatToken: string };
      const detail = await fetch(`/api/public/webchat/conversations/${body.conversationId}?chatToken=${encodeURIComponent(body.chatToken)}`);
      const conversation = await detail.json();
      setChat({ conversationId: body.conversationId, chatToken: body.chatToken, messages: conversation.messages ?? [] });
      startPolling(body.conversationId, body.chatToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start chat.");
    }
  }

  async function send() {
    if (!chat || !draft.trim()) return;
    setError("");
    try {
      const response = await fetch(`/api/public/webchat/conversations/${chat.conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatToken: chat.chatToken, body: draft }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const conversation = await response.json();
      setChat({ ...chat, messages: conversation.messages ?? [] });
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send message.");
    }
  }

  if (!chat) {
    return <div className="mx-auto grid max-w-md gap-3 rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Chat with us</h2>
      <p className="text-sm text-slate-600">Ask about this property. Our AI receptionist responds instantly and can bring in a team member if needed.</p>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      <input className="rounded-lg border p-3 text-sm" onChange={(event) => setName(event.target.value)} placeholder="Your name" value={name} />
      <input className="rounded-lg border p-3 text-sm" onChange={(event) => setEmail(event.target.value)} placeholder="Email (optional)" value={email} />
      <textarea className="rounded-lg border p-3 text-sm" onChange={(event) => setMessage(event.target.value)} placeholder="How can we help?" rows={3} value={message} />
      <button className="rounded-lg bg-slate-950 p-3 font-semibold text-white disabled:opacity-50" disabled={!message.trim()} onClick={start}>Start chat</button>
    </div>;
  }

  return <div className="mx-auto grid max-w-md gap-3 rounded-2xl border bg-white p-6 shadow-sm">
    <h2 className="text-lg font-semibold">Live chat</h2>
    {error && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
    <div className="grid max-h-96 gap-2 overflow-auto rounded-lg bg-slate-50 p-3">
      {chat.messages.map((item) => <div className={`max-w-[85%] rounded-xl p-2 text-sm ${item.direction === "OUTBOUND" ? "bg-emerald-600 text-white" : "ml-auto bg-white"}`} key={item.id}>{item.body}</div>)}
    </div>
    <div className="flex gap-2"><input className="flex-1 rounded-lg border p-3 text-sm" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void send()} placeholder="Type a message..." value={draft} /><button className="rounded-lg bg-slate-950 px-4 font-semibold text-white" onClick={send}>Send</button></div>
  </div>;
}
