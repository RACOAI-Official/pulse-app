"use client";

import AgentEditor from "@/components/AgentEditor";
import WorkspaceShell from "@/components/WorkspaceShell";

export default function AgentPage() {
  return <WorkspaceShell>{workspace => <AgentEditor key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
