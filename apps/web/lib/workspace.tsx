"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, TenantMembership } from "./api";
import { supabase } from "./supabase";

type WorkspaceState = {
  memberships: TenantMembership[];
  tenantId: string;
  setTenantId: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string;
  signOut: () => Promise<void>;
  current: TenantMembership | undefined;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const publicPaths = new Set(["/login", "/signup", "/auth/callback", "/notifications/verify"]);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [tenantId, setTenantIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (publicPaths.has(pathname) || ready) return;
    let active = true;
    async function openWorkspace() {
      try {
        const { data } = await supabase().auth.getSession();
        if (!active) return;
        if (!data.session) {
          window.sessionStorage.setItem("pulse-return", window.location.pathname + window.location.search);
          router.replace("/login");
          return;
        }
        const rows = await api<TenantMembership[]>("/me/tenants");
        if (!active) return;
        const requested = new URLSearchParams(window.location.search).get("tenant_id");
        const saved = requested || window.localStorage.getItem("pulse-tenant");
        setMemberships(rows);
        setTenantIdState(rows.find(item => item.tenant_id === saved)?.tenant_id || rows[0]?.tenant_id || "");
        setReady(true);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load your workspace");
      } finally {
        if (active) setLoading(false);
      }
    }
    void openWorkspace();
    return () => { active = false; };
  }, [pathname, ready, router]);

  const setTenantId = useCallback((id: string) => {
    window.localStorage.setItem("pulse-tenant", id);
    setTenantIdState(id);
  }, []);

  const refresh = useCallback(async () => {
    const rows = await api<TenantMembership[]>("/me/tenants");
    setMemberships(rows);
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    setMemberships([]);
    setTenantIdState("");
    setReady(false);
    setLoading(true);
    router.replace("/login");
  }, [router]);

  const value = useMemo(() => ({ memberships, tenantId, setTenantId, refresh, loading, error, signOut,
    current: memberships.find(item => item.tenant_id === tenantId) }),
  [memberships, tenantId, setTenantId, refresh, loading, error, signOut]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace must be inside WorkspaceProvider");
  return workspace;
}
