"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, TenantMembership } from "./api";
import { supabase } from "./supabase";

export function useWorkspace() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [tenantId, setTenantIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    supabase().auth.getSession().then(async ({ data }) => {
      if (!data.session) { window.sessionStorage.setItem("pulse-return", window.location.pathname + window.location.search); router.replace("/login"); return; }
      try {
        const rows = await api<TenantMembership[]>("/me/tenants");
        if (!active) return;
        setMemberships(rows);
        const requested = new URLSearchParams(window.location.search).get("tenant_id");
        const saved = requested || window.localStorage.getItem("pulse-tenant");
        setTenantIdState(rows.find(item => item.tenant_id === saved)?.tenant_id || rows[0]?.tenant_id || "");
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load your workspace");
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [router]);

  const setTenantId = useCallback((id: string) => {
    window.localStorage.setItem("pulse-tenant", id);
    setTenantIdState(id);
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    router.replace("/login");
  }, [router]);

  return { memberships, tenantId, setTenantId, loading, error, signOut,
    current: memberships.find(item => item.tenant_id === tenantId) };
}
