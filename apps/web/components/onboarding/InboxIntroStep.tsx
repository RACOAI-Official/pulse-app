"use client";

import { useState } from "react";
import { ArrowRight, Bot, Inbox, InstagramLogo, MessengerLogo, UserSwitch, WhatsappLogo } from "@/components/icons";

const threads = [
  { name: "Rafiq H.", Icon: MessengerLogo, text: "Is the black panjabi available in L?", who: "ai", time: "now" },
  { name: "nusrat.style", Icon: InstagramLogo, text: "Delivery charge outside Dhaka koto?", who: "ai", time: "2m" },
  { name: "+880 17•• •••412", Icon: WhatsappLogo, text: "I want to return my order", who: "human", time: "6m" },
] as const;

export default function InboxIntroStep({ onFinish }: { onFinish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish() {
    setBusy(true); setError("");
    try { await onFinish(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not finish setup"); setBusy(false); }
  }

  return <section className="onb-card onb-inbox">
    <span className="onb-glyph"><Inbox size={26} weight="duotone" /></span>
    <h1>Meet your Inbox</h1>
    <p>Every customer message from your connected channels lands here. Your assistant answers first; your team steps in whenever needed.</p>
    <div className="onb-inbox-demo" aria-hidden="true">
      {threads.map(({ name, Icon, text, who, time }, index) => <div className="onb-thread" key={name} style={{ animationDelay: `${120 + index * 110}ms` }}>
        <span className="onb-thread-avatar"><Icon size={16} weight="fill" /></span>
        <div><strong>{name}</strong><p>{text}</p></div>
        <span className={`onb-thread-tag ${who}`}>{who === "ai" ? <><Bot size={12} /> AI replying</> : <><UserSwitch size={12} /> Needs you</>}</span>
        <small>{time}</small>
      </div>)}
    </div>
    <ul className="onb-points">
      <li><Bot size={18} /><span><b>AI answers instantly</b> using your setup, catalog, and delivery fees. Each reply uses one credit.</span></li>
      <li><UserSwitch size={18} /><span><b>Take over any chat.</b> Tricky questions, photos, and returns are handed to your team.</span></li>
      <li><Inbox size={18} /><span><b>Out of credits?</b> Messages keep arriving and wait in the Inbox for your team.</span></li>
    </ul>
    {error && <p className="form-notice" role="alert">{error}</p>}
    <div className="onb-actions"><span /><button className="button primary" disabled={busy} onClick={finish}>{busy ? "Finishing…" : "Go to dashboard"}<ArrowRight size={16} /></button></div>
  </section>;
}
