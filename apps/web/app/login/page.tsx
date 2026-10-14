"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, LockKeyhole } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (reset) {
        const { error } = await supabase().auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (error) throw error;
        setNotice("Check your email for a recovery link.");
      } else {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/inbox");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <div className="auth-brand"><span className="brand-mark">P</span><span>pulse<span className="brand-dot">.</span></span></div>
    <div className="auth-grid">
      <section className="auth-story">
        <div className="eyebrow">CUSTOMER OPERATIONS / ONE VIEW</div>
        <h1>Every conversation,<br /><em>in rhythm.</em></h1>
        <p>Bring your customer messages into one focused workspace. Your team stays close to every reply.</p>
        <div className="auth-lines" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
      </section>
      <section className="auth-card">
        <div className="eyebrow">{reset ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</div>
        <h2>{reset ? "Reset your password" : "Sign in to Pulse"}</h2>
        <p>{reset ? "We will email you a secure recovery link." : "Pick up the conversation where your team left off."}</p>
        <form onSubmit={submit}>
          <label>Email address<div className="input-shell"><Mail size={18} /><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></div></label>
          {!reset && <label>Password<div className="input-shell"><LockKeyhole size={18} /><input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /></div></label>}
          {notice && <div className="form-notice" role="status">{notice}</div>}
          <button type="submit" className="button primary wide" disabled={busy}>{busy ? "Please wait…" : reset ? "Send recovery link" : "Sign in"}<ArrowRight size={17} /></button>
        </form>
        <button className="text-button auth-switch" onClick={() => { setReset(!reset); setNotice(""); }}>{reset ? "Back to sign in" : "Forgot password?"}</button>
      </section>
    </div>
    <div className="auth-footer">PULSE / OPERATIONS WORKSPACE <span>2026</span></div>
  </main>;
}
