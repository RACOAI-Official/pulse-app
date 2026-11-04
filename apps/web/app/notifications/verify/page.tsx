"use client";
import { useState } from "react";
import Link from "next/link";

export default function VerifyNotificationEmail() {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function verify() {
    setBusy(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/notifications/verify-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: window.location.hash.slice(1) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Invalid verification link");
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true); setNotice("Email verified. Return to Settings, refresh, and enable email notifications.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Verification failed"); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card"><h1>Verify notification email</h1><p>Confirm this address can receive order notifications from Pulse.</p><button className="button primary" disabled={busy || done} onClick={verify}>{busy ? "Verifying…" : "Verify email"}</button><p role="status">{notice}</p><Link href="/settings">Return to settings</Link></section></main>;
}
