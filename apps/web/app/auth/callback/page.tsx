"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data, error }) => {
      if (error) setNotice(error.message);
      else if (data.session) setReady(true);
      else setNotice("This link is invalid or expired. Request a new invitation or recovery email.");
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error } = await supabase().auth.updateUser({ password });
    if (error) setNotice(error.message);
    else router.replace("/inbox");
  }

  return <main className="auth-screen callback-screen"><div className="auth-brand"><span className="brand-mark">P</span><span>pulse<span className="brand-dot">.</span></span></div>
    <section className="auth-card"><div className="eyebrow">ACCOUNT ACCESS</div><h2>Set your password</h2>
      <p>Choose a password to finish your invitation or recovery.</p>
      {ready && <form onSubmit={submit}><label>New password<input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></label><button type="submit" className="button primary wide">Continue to Pulse</button></form>}
      {notice && <div className="form-notice" role="status">{notice}</div>}</section>
  </main>;
}
