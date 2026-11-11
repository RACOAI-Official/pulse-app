"use client";

import PlanPicker from "@/components/PlanPicker";
import WorkspaceShell from "@/components/WorkspaceShell";

export default function PlanPage() {
  return <WorkspaceShell>{workspace => <PlanPicker key={workspace.tenantId} tenantId={workspace.tenantId} role={workspace.current?.role || "staff"} />}</WorkspaceShell>;
}
