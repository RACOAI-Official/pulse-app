"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Settings2, LogOut, ChevronDown, Package, ShoppingBag } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

export type Workspace = ReturnType<typeof useWorkspace>;

export default function WorkspaceShell({ children }: { children: (workspace: Workspace) => React.ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  if (workspace.loading) return <main className="loading-screen"><span className="brand-mark">P</span><p>Opening workspace…</p></main>;
  if (workspace.error) return <main className="loading-screen"><span className="brand-mark">P</span><p>{workspace.error}</p><button className="button" onClick={() => location.reload()}>Try again</button></main>;
  return <div className="workspace">
    <aside className="rail">
      <Link href="/inbox" className="rail-brand" aria-label="Pulse inbox">P<span>.</span></Link>
      <nav aria-label="Main navigation">
        <Link href="/inbox" className={pathname === "/inbox" ? "rail-link active" : "rail-link"} title="Inbox"><Inbox size={21} /><span>Inbox</span></Link>
        <Link href="/catalog" className={pathname === "/catalog" ? "rail-link active" : "rail-link"} title="Catalog"><Package size={21} /><span>Catalog</span></Link>
        <Link href="/orders" className={pathname === "/orders" ? "rail-link active" : "rail-link"} title="Orders"><ShoppingBag size={21} /><span>Orders</span></Link>
        <Link href="/settings" className={pathname === "/settings" ? "rail-link active" : "rail-link"} title="Settings"><Settings2 size={21} /><span>Settings</span></Link>
      </nav>
      <button className="rail-link rail-exit" onClick={workspace.signOut} title="Sign out"><LogOut size={20} /><span>Exit</span></button>
    </aside>
    <div className="workspace-main">
      <header className="workspace-topbar">
        <div className="workspace-title"><span className="eyebrow">PULSE / OPERATIONS</span><strong>{pathname === "/settings" ? "Settings" : pathname === "/catalog" ? "Catalog" : pathname === "/orders" ? "Orders" : "Inbox"}</strong></div>
        <div className="topbar-actions">
          <div className="workspace-select"><span>WORKSPACE</span><select aria-label="Workspace" value={workspace.tenantId} onChange={e => workspace.setTenantId(e.target.value)}>
            {workspace.memberships.map(item => <option key={item.tenant_id} value={item.tenant_id}>{item.tenants.name}</option>)}
          </select><ChevronDown size={15} /></div>
          <span className="operator-avatar" title={workspace.current?.role || "Member"}>{workspace.current?.tenants.name?.charAt(0).toUpperCase() || "P"}</span>
        </div>
      </header>
      {workspace.tenantId ? children(workspace) : <section className="empty-workspace"><h2>No workspace yet</h2><p>An operator needs to create your first Pulse workspace and invite you.</p></section>}
    </div>
  </div>;
}
