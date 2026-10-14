import { supabase } from "./supabase";

export interface TenantMembership {
  tenant_id: string;
  role: "owner" | "staff";
  tenants: { id: string; name: string };
}

export interface ChannelConnection {
  id: string;
  channel: "messenger" | "instagram" | "whatsapp";
  display_name: string;
  external_account_id: string;
  status: "connected" | "disconnected";
}

export interface Conversation {
  id: string;
  tenant_id: string;
  channel: ChannelConnection["channel"];
  external_thread_id: string;
  customer_name: string | null;
  state: "open" | "resolved";
  unread_count: number;
  last_inbound_at: string | null;
  last_message_at: string;
}

export interface InboxMedia {
  type: string;
  path?: string;
  mime_type?: string;
  unavailable?: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender_type: "customer" | "human" | "system";
  body: string | null;
  media: InboxMedia[];
  delivery_state: "queued" | "sending" | "sent" | "failed" | "uncertain" | null;
  failure_reason: string | null;
  created_at: string;
}

const apiBase = process.env.NEXT_PUBLIC_API_URL;

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiBase) throw new Error("Pulse API URL is missing");
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).detail || message; } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function websocketBase(): string {
  if (!apiBase) throw new Error("Pulse API URL is missing");
  return apiBase.replace(/^http/, "ws");
}
