"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, BarChart3, Bot, BookOpen, Boxes, ChevronDown, CreditCard, Headphones, Inbox, LifeBuoy, LogOut, Megaphone, Menu, MessageSquareText, Package, Phone, Settings2, ShoppingBag, Users, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

export type Workspace = ReturnType<typeof useWorkspace>;

const sections = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/dashboard", icon: BarChart3 }, { label: "Inbox", href: "/inbox", icon: Inbox }, { label: "Integrations", href: "/integrations", icon: Boxes }] },
  { label: "Sales", items: [{ label: "Orders", href: "/orders", icon: ShoppingBag }, { label: "Products", href: "/catalog", icon: Package }, { label: "Parcels", href: "/features/parcels", icon: Boxes }, { label: "Customers", href: "/customers", icon: Users }] },
  { label: "Calls", items: [{ label: "AI Calls", href: "/features/ai-calls", icon: Phone }, { label: "Recordings", href: "/features/recordings", icon: Headphones }] },
  { label: "Marketing", items: [{ label: "AdsFlow", href: "/features/adsflow", icon: Activity }, { label: "Creative Studio", href: "/features/creative-studio", icon: Megaphone }, { label: "Ad Launcher", href: "/features/ad-launcher", icon: Megaphone }, { label: "Broadcast", href: "/features/broadcast", icon: Megaphone }] },
  { label: "AI Training", items: [{ label: "AI Setup", href: "/agent", icon: Bot }, { label: "Train Content", href: "/training", icon: BookOpen }, { label: "Admin Agent", href: "/admin-agent", icon: MessageSquareText }] },
  { label: "Insights", items: [{ label: "Analytics", href: "/analytics", icon: BarChart3 }, { label: "Performance", href: "/performance", icon: Users }, { label: "Activity Log", href: "/activity-log", icon: Activity }, { label: "Chat Summary", href: "/features/chat-summary", icon: MessageSquareText }] },
  { label: "Account", items: [{ label: "Billing", href: "/features/billing", icon: CreditCard }, { label: "Settings", href: "/settings", icon: Settings2 }] },
  { label: "Help", items: [{ label: "Tutorials", href: "/features/tutorials", icon: BookOpen }, { label: "Support", href: "/features/support", icon: LifeBuoy }] },
] as const;

const titles = Object.fromEntries(sections.flatMap(section => section.items.map(item => [item.href, item.label])));

export default function WorkspaceShell({ children }: { children: (workspace: Workspace) => React.ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (workspace.loading) return <main className="loading-screen"><span className="brand-mark">P</span><p>Opening workspace…</p></main>;
  if (workspace.error) return <main className="loading-screen"><span className="brand-mark">P</span><p>{workspace.error}</p><button className="button" onClick={() => location.reload()}>Try again</button></main>;

  return <div className="workspace">
    <button className="mobile-nav-button" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
    <aside className={`rail ${open ? "rail-open" : ""}`}>
      <Link href="/dashboard" className="rail-brand" onClick={() => setOpen(false)} aria-label="Pulse dashboard">P<span>.</span><strong>Pulse</strong></Link>
      <nav aria-label="Main navigation">{sections.map(section => <div className="nav-section" key={section.label}>
        <div className="nav-section-label">{section.label}</div>
        {section.items.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`rail-link ${pathname === item.href ? "active" : ""}`}><Icon size={17} /><span>{item.label}</span></Link>; })}
      </div>)}</nav>
      <button className="rail-link rail-exit" onClick={workspace.signOut}><LogOut size={17} /><span>Sign out</span></button>
    </aside>
    <div className="workspace-main">
      <header className="workspace-topbar">
        <div className="workspace-title"><span className="eyebrow">PULSE / WORKSPACE</span><strong>{titles[pathname] || "Pulse"}</strong></div>
        <div className="topbar-actions"><div className="workspace-select"><span>BUSINESS</span><select aria-label="Workspace" value={workspace.tenantId} onChange={e => workspace.setTenantId(e.target.value)}>{workspace.memberships.map(item => <option key={item.tenant_id} value={item.tenant_id}>{item.tenants.name}</option>)}</select><ChevronDown size={15} /></div><span className="operator-avatar" title={workspace.current?.role || "Member"}>{workspace.current?.tenants.name?.charAt(0).toUpperCase() || "P"}</span></div>
      </header>
      {workspace.tenantId ? children(workspace) : <section className="empty-workspace"><h2>No workspace yet</h2><p>An operator needs to create your first Pulse workspace and invite you.</p></section>}
    </div>
  </div>;
}
