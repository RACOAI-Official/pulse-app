import type { Metadata, Viewport } from "next";
import { Inter, Bricolage_Grotesque } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const title = "Pulse — From message to order. Automatically.";
const description =
  "Pulse is the AI-powered social commerce workspace by RACO AI. Answer customers on Messenger and Instagram, capture orders, and manage sales in one place. Now in beta.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "Pulse",
  keywords: ["social commerce", "AI sales assistant", "Messenger", "Instagram", "order management", "unified inbox", "Pulse", "RACO AI"],
  authors: [{ name: "RACO AI Technologies", url: "https://racoai.io" }],
  openGraph: {
    title,
    description,
    siteName: "Pulse",
    type: "website",
  },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#fbfcf9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${display.variable} font-sans antialiased bg-paper text-ink overflow-x-clip`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
