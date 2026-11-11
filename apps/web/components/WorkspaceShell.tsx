"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BarChart3, Bot, BookOpen, Boxes, ChevronDown, CreditCard, Headphones, Inbox, LifeBuoy, LogOut, Megaphone, Menu, MessageSquareText, Package, Phone, Settings2, ShoppingBag, Users, X } from "@/components/icons";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export type Workspace = ReturnType<typeof useWorkspace>;

const sections = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/dashboard", icon: BarChart3 }, { label: "Inbox", href: "/inbox", icon: Inbox }, { label: "Integrations", href: "/integrations", icon: Boxes }] },
  { label: "Sales", items: [{ label: "Orders", href: "/orders", icon: ShoppingBag }, { label: "Products", href: "/catalog", icon: Package }, { label: "Parcels", href: "/features/parcels", icon: Boxes }, { label: "Customers", href: "/customers", icon: Users }] },
  { label: "Calls", items: [{ label: "AI Calls", href: "/features/ai-calls", icon: Phone }, { label: "Recordings", href: "/features/recordings", icon: Headphones }] },
  { label: "Marketing", items: [{ label: "AdsFlow", href: "/features/adsflow", icon: Activity }, { label: "Creative Studio", href: "/features/creative-studio", icon: Megaphone }, { label: "Ad Launcher", href: "/features/ad-launcher", icon: Megaphone }, { label: "Broadcast", href: "/features/broadcast", icon: Megaphone }] },
  { label: "AI Training", items: [{ label: "AI Setup", href: "/agent", icon: Bot }, { label: "Train Content", href: "/training", icon: BookOpen }, { label: "Admin Agent", href: "/admin-agent", icon: MessageSquareText }] },
  { label: "Insights", items: [{ label: "Analytics", href: "/analytics", icon: BarChart3 }, { label: "Performance", href: "/performance", icon: Users }, { label: "Activity Log", href: "/activity-log", icon: Activity }, { label: "Chat Summary", href: "/features/chat-summary", icon: MessageSquareText }] },
  { label: "Account", items: [{ label: "Plan", href: "/plan", icon: CreditCard }, { label: "Settings", href: "/settings", icon: Settings2 }] },
  { label: "Help", items: [{ label: "Tutorials", href: "/features/tutorials", icon: BookOpen }, { label: "Support", href: "/features/support", icon: LifeBuoy }] },
] as const;

const titles = Object.fromEntries(sections.flatMap(section => section.items.map(item => [item.href, item.label])));

export default function WorkspaceShell({ children }: { children: (workspace: Workspace) => React.ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const setupPending = !!workspace.current && (workspace.current.tenants.onboarding_step ?? "done") !== "done";
  const isOwner = workspace.current?.role === "owner";
  useEffect(() => {
    if (setupPending && isOwner) router.replace("/onboarding");
  }, [setupPending, isOwner, router]);
  const [open, setOpen] = useState(false);
  const [unseenOrders, setUnseenOrders] = useState(0);
  const tenantId = workspace.tenantId;
  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    const load = () => api<{ count: number }>(`/tenants/${tenantId}/commerce/orders/unseen-count`).then(r => { if (alive) setUnseenOrders(r.count); }).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("pulse:orders-seen", load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("pulse:orders-seen", load); };
  }, [tenantId]);
  if (workspace.loading) return <main className="loading-screen"><span className="brand-mark">P</span><p>Opening workspace…</p></main>;
  if (setupPending && isOwner) return <main className="loading-screen"><span className="brand-mark">P</span><p>Finishing your setup…</p></main>;
  if (workspace.error) return <main className="loading-screen"><span className="brand-mark">P</span><p>{workspace.error}</p><button className="button" onClick={() => location.reload()}>Try again</button></main>;

  return <div className="workspace">
    <button className="mobile-nav-button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
    {open && <button className="rail-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`rail ${open ? "rail-open" : ""}`}>
      <Link href="/dashboard" className="rail-brand" onClick={() => setOpen(false)} aria-label="Pulse dashboard"><span className="rail-brand-mark">P</span><strong>Pulse</strong></Link>
      <nav id="workspace-navigation" aria-label="Main navigation">{sections.map(section => <div className="nav-section" key={section.label}>
        <div className="nav-section-label">{section.label}</div>
        {section.items.map(item => { const Icon = item.icon; const active = pathname === item.href; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`rail-link ${active ? "active" : ""}`}><Icon size={17} weight={active ? "fill" : "regular"} /><span>{item.label}</span>{item.href === "/orders" && unseenOrders > 0 && <b className="rail-badge" aria-label={`${unseenOrders} new AI orders`}>{unseenOrders > 99 ? "99+" : unseenOrders}</b>}</Link>; })}
      </div>)}</nav>
      <div className="rail-account"><div className="rail-account-identity"><span className="rail-account-avatar" aria-hidden="true">{workspace.current?.tenants.name?.charAt(0).toUpperCase() || "P"}</span><div className="rail-account-copy"><strong title={workspace.current?.tenants.name || "Workspace"}>{workspace.current?.tenants.name || "Workspace"}</strong><span>{workspace.current?.role || "Member"}</span></div></div><button className="rail-link rail-exit" onClick={workspace.signOut}><LogOut size={18} /><span>Sign out</span></button></div>
    </aside>
    <div className="workspace-main">
      <header className="workspace-topbar">
        <div className="workspace-title"><span>Pulse workspace</span><strong>{titles[pathname] || "Pulse"}</strong></div>
        <div className="topbar-actions"><label className="workspace-select"><span>Business</span><select aria-label="Business workspace" value={workspace.tenantId} onChange={e => workspace.setTenantId(e.target.value)}>{workspace.memberships.map(item => <option key={item.tenant_id} value={item.tenant_id}>{item.tenants.name}</option>)}</select><ChevronDown size={15} /></label><span className="operator-avatar" title={workspace.current?.role || "Member"}>{workspace.current?.tenants.name?.charAt(0).toUpperCase() || "P"}</span></div>
      </header>
      {setupPending ? <section className="empty-workspace"><h2>Workspace setup in progress</h2><p>The owner of {workspace.current?.tenants.name || "this business"} is still finishing onboarding. Check back soon.</p></section> : workspace.tenantId ? children(workspace) : <section className="empty-workspace"><h2>No workspace yet</h2><p>An operator needs to create your first Pulse workspace and invite you.</p></section>}
    </div>
  </div>;
}
