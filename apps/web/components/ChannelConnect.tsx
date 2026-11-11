"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, InstagramLogo, MessengerLogo, Truck, WhatsappLogo, X } from "@/components/icons";
import { api, ChannelConnection } from "@/lib/api";

type Channel = ChannelConnection["channel"];
type OAuthConfig = { meta_app_id: string; whatsapp_config_id: string; graph_version: string; providers: Record<Channel, boolean> };
type PickPage = { id: string; name: string };
type MerchantConnection = { provider: "pathao"; environment?: string; status: string; updated_at?: string };

const channels: { key: Channel; name: string; detail: string; Icon: typeof MessengerLogo }[] = [
  { key: "messenger", name: "Facebook Messenger", detail: "Reply to Page inbox messages and comments", Icon: MessengerLogo },
  { key: "instagram", name: "Instagram", detail: "Professional account DMs and comments", Icon: InstagramLogo },
  { key: "whatsapp", name: "WhatsApp", detail: "Cloud API business number", Icon: WhatsappLogo },
];
const credentialFields = ["client_id", "client_secret", "username", "password"] as const;

type FBLoginResponse = { authResponse?: { code?: string } | null };
type FBSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (callback: (response: FBLoginResponse) => void, options: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FBSdk; fbAsyncInit?: () => void } }

function loadFacebookSdk(appId: string, version: string): Promise<FBSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return; }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true; script.defer = true; script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Could not load Facebook. Check your connection or ad blocker."));
    document.body.appendChild(script);
  });
}

function messageOf(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : fallback;
}

/** Self-serve Messenger / Instagram / WhatsApp connect. Shared by onboarding and the Integrations page. */
export default function ChannelConnect({ tenantId, isOwner, paid, returnTo, onChange }: {
  tenantId: string; isOwner: boolean; paid: boolean; returnTo: "onboarding" | "integrations";
  onChange?: (rows: ChannelConnection[]) => void;
}) {
  const [rows, setRows] = useState<ChannelConnection[]>([]);
  const [config, setConfig] = useState<OAuthConfig | null>(null);
  const [pick, setPick] = useState("");
  const [pages, setPages] = useState<PickPage[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<Channel | "pick" | "">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const next = await api<ChannelConnection[]>(`/tenants/${tenantId}/channels`);
    setRows(next); onChange?.(next);
  }, [tenantId, onChange]);

  useEffect(() => {
    load().catch(caught => setError(messageOf(caught, "Could not load channels")));
    api<OAuthConfig>(`/tenants/${tenantId}/oauth/config`).then(setConfig).catch(() => setConfig(null));
  }, [tenantId, load]);

  // Results of the OAuth round trip arrive as query params on the return page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauth_error");
    const connected = params.get("connected");
    const pickId = params.get("pick");
    if (oauthError) setError(oauthError);
    if (connected) setNotice(`${connected === "instagram" ? "Instagram" : connected} connected.`);
    if (pickId) {
      setPick(pickId);
      api<PickPage[]>(`/tenants/${tenantId}/oauth/meta/pick/${encodeURIComponent(pickId)}`)
        .then(list => { setPages(list); setChosen(list.map(page => page.id)); })
        .catch(caught => setError(messageOf(caught, "Page selection expired")));
    }
    if (oauthError || connected || pickId) {
      params.delete("oauth_error"); params.delete("connected"); params.delete("pick");
      const rest = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, [tenantId]);

  async function startRedirect(channel: "messenger" | "instagram") {
    setBusy(channel); setError(""); setNotice("");
    try {
      const { url } = await api<{ url: string }>(`/tenants/${tenantId}/oauth/${channel}/start`, {
        method: "POST", body: JSON.stringify({ return_to: returnTo }),
      });
      window.location.assign(url);
    } catch (caught) { setError(messageOf(caught, "Could not start connect")); setBusy(""); }
  }

  async function startWhatsApp() {
    if (!config) return;
    setBusy("whatsapp"); setError(""); setNotice("");
    let session: { waba_id?: string; phone_number_id?: string } = {};
    const listener = (event: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") session = data.data || {};
      } catch {}
    };
    window.addEventListener("message", listener);
    try {
      const FB = await loadFacebookSdk(config.meta_app_id, config.graph_version);
      const code = await new Promise<string>((resolve, reject) => FB.login(response => {
        const value = response.authResponse?.code;
        if (value) resolve(value); else reject(new Error("WhatsApp setup was cancelled"));
      }, { config_id: config.whatsapp_config_id, response_type: "code", override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } }));
      // The session message can trail the login callback slightly.
      for (let wait = 0; wait < 10 && !session.phone_number_id; wait++) await new Promise(r => setTimeout(r, 300));
      if (!session.waba_id || !session.phone_number_id) throw new Error("WhatsApp did not share a business number. Finish every step of the popup.");
      await api(`/tenants/${tenantId}/oauth/whatsapp/complete`, { method: "POST",
        body: JSON.stringify({ code, waba_id: session.waba_id, phone_number_id: session.phone_number_id }) });
      await load();
      setNotice("WhatsApp connected.");
    } catch (caught) { setError(messageOf(caught, "WhatsApp connect failed")); }
    finally { window.removeEventListener("message", listener); setBusy(""); }
  }

  async function savePages(event: FormEvent) {
    event.preventDefault();
    setBusy("pick"); setError("");
    try {
      await api(`/tenants/${tenantId}/oauth/meta/select`, { method: "POST", body: JSON.stringify({ pick, page_ids: chosen }) });
      setPick(""); setPages([]);
      await load();
      setNotice(chosen.length === 1 ? "Facebook Page connected." : `${chosen.length} Facebook Pages connected.`);
    } catch (caught) { setError(messageOf(caught, "Could not connect the Page")); }
    finally { setBusy(""); }
  }

  async function disconnect(row: ChannelConnection) {
    if (!window.confirm(`Disconnect ${row.display_name}? AI and the Inbox stop receiving its messages.`)) return;
    setError("");
    try { await api(`/tenants/${tenantId}/channels/${row.id}`, { method: "DELETE" }); await load(); }
    catch (caught) { setError(messageOf(caught, "Could not disconnect")); }
  }

  const locked = !paid;
  return <section className="connect" aria-label="Channels">
    {error && <p className="form-notice plan-banner warn" role="alert">{error}</p>}
    {notice && <p className="form-notice plan-banner" role="status">{notice}</p>}
    {locked && <p className="form-notice plan-banner info">Channel integrations need Pro. Your trial covers AI setup and preview.</p>}

    {pages.length > 0 && <form className="commerce-card connect-pick" onSubmit={savePages}>
      <h2>Choose Facebook Pages</h2>
      <p>Pulse will answer messages and comments for the Pages you pick.</p>
      <div className="connect-pick-list">{pages.map(page => <label key={page.id} className="connect-pick-row">
        <input type="checkbox" checked={chosen.includes(page.id)} onChange={event => setChosen(event.target.checked ? [...chosen, page.id] : chosen.filter(id => id !== page.id))} />
        <MessengerLogo size={18} /><span>{page.name}</span>
      </label>)}</div>
      <div className="commerce-actions"><button className="button primary" disabled={busy === "pick" || !chosen.length}>{busy === "pick" ? "Connecting…" : "Connect selected"}</button>
        <button type="button" className="button subtle" onClick={() => { setPick(""); setPages([]); }}>Cancel</button></div>
    </form>}

    <div className="connect-grid">{channels.map(({ key, name, detail, Icon }) => {
      const connected = rows.filter(row => row.channel === key && row.status === "connected");
      const ready = config?.providers[key] ?? false;
      return <article key={key} className={`connect-card ${key} ${connected.length ? "is-connected" : ""}`}>
        <div className="connect-head"><span className="connect-icon"><Icon size={22} weight="fill" /></span><div><h3>{name}</h3><p>{detail}</p></div></div>
        {connected.map(row => <div className="connect-asset" key={row.id}><Check size={14} weight="bold" /><span>{row.display_name}</span>
          {isOwner && <button className="icon-button" aria-label={`Disconnect ${row.display_name}`} onClick={() => disconnect(row)}><X size={14} /></button>}</div>)}
        {isOwner && <button className={`button wide ${connected.length ? "subtle" : "primary"}`} disabled={locked || !ready || !!busy}
          onClick={() => key === "whatsapp" ? startWhatsApp() : startRedirect(key)}>
          {busy === key ? "Opening…" : !ready ? "Not configured yet" : connected.length ? "Connect another" : `Connect ${key === "messenger" ? "Facebook" : name}`}
        </button>}
      </article>;
    })}</div>
  </section>;
}

/** Optional Pathao courier credentials (encrypted server-side). */
export function PathaoConnect({ tenantId, isOwner, paid }: { tenantId: string; isOwner: boolean; paid: boolean }) {
  const [merchants, setMerchants] = useState<MerchantConnection[]>([]);
  const [environment, setEnvironment] = useState("sandbox");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<MerchantConnection[]>(`/tenants/${tenantId}/integrations`).then(setMerchants).catch(caught => setError(messageOf(caught, "Could not load"))); }, [tenantId]);
  const pathao = merchants.find(item => item.provider === "pathao");

  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setSaved(false);
    try {
      await api(`/tenants/${tenantId}/integrations/pathao`, { method: "PUT", body: JSON.stringify({ environment, credentials }) });
      setMerchants(await api<MerchantConnection[]>(`/tenants/${tenantId}/integrations`));
      setCredentials({}); setOpen(false); setSaved(true);
    } catch (caught) { setError(messageOf(caught, "Could not save connection")); }
  }

  return <section className="commerce-card connect-courier">
    <div className="connect-head"><span className="connect-icon courier"><Truck size={22} weight="fill" /></span><div><h3>Pathao Courier <small>optional</small></h3>
      <p>Manual courier handoff works without this. Connecting prepares automatic booking.</p></div>
      <span className={`commerce-state ${pathao?.status === "verified" ? "completed" : "draft"}`}>{(pathao?.status || "not_connected").replaceAll("_", " ")}</span></div>
    {error && <p className="form-notice" role="alert">{error}</p>}
    {saved && <p className="form-notice" role="status">Saved. It stays unverified until provider testing completes.</p>}
    {isOwner && !open && <button className="button subtle" disabled={!paid} onClick={() => setOpen(true)}>{pathao && pathao.status !== "not_connected" ? "Update credentials" : "Add credentials"}</button>}
    {isOwner && open && <form onSubmit={save} className="commerce-form-grid">
      <label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value)}><option value="sandbox">Sandbox</option><option value="live">Live</option></select></label>
      {credentialFields.map(field => <label key={field}>{field.replaceAll("_", " ")}<input required type={field.includes("secret") || field.includes("pass") ? "password" : "text"} autoComplete="off" value={credentials[field] || ""} onChange={event => setCredentials({ ...credentials, [field]: event.target.value })} /></label>)}
      <div className="wide commerce-actions"><button type="submit" className="button primary">Save credentials</button><button type="button" className="button subtle" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </section>;
}
