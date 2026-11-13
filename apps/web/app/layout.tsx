import type { Metadata } from "next";
import { WorkspaceProvider } from "@/lib/workspace";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse — Business workspace",
  description: "Manage customer conversations, commerce, and business insights in one workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><WorkspaceProvider>{children}</WorkspaceProvider></body></html>;
}
