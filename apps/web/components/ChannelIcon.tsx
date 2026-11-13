import { useId } from "react";

export type ChannelKind = "messenger" | "instagram" | "whatsapp" | "facebook";

const names: Record<ChannelKind, string> = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp", facebook: "Facebook" };

/** Full-colour channel brand marks (Messenger/Instagram shared with the marketing site). */
export default function ChannelIcon({ channel, size = 16, className, title }: { channel: ChannelKind; size?: number; className?: string; title?: boolean }) {
  const id = useId().replace(/:/g, "");
  const a11y = title ? { role: "img", "aria-label": names[channel] } : { "aria-hidden": true };
  const common = { viewBox: "0 0 24 24", width: size, height: size, className, ...a11y };
  if (channel === "instagram") {
    return <svg {...common}>
      <defs><radialGradient id={`ig${id}`} cx="30%" cy="107%" r="150%"><stop offset="0" stopColor="#fdf497" /><stop offset=".05" stopColor="#fdf497" /><stop offset=".45" stopColor="#fd5949" /><stop offset=".6" stopColor="#d6249f" /><stop offset=".9" stopColor="#285AEB" /></radialGradient></defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#ig${id})`} />
      <rect x="6.5" y="6.5" width="11" height="11" rx="5.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="#fff" />
    </svg>;
  }
  if (channel === "whatsapp") {
    return <svg {...common}>
      <path d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.97 5.1-1.33A10 10 0 1 0 12 2Z" fill="#25D366" />
      <path d="M8.55 6.9c.2-.4.42-.42.62-.43h.52c.18 0 .43.06.63.5l.83 2c.07.17.1.38-.01.57l-.42.62c-.13.18-.25.33-.05.66.42.72 1.62 2.08 3.06 2.68.28.12.45.1.62-.09l.66-.8c.18-.21.37-.2.6-.1l1.88.9c.24.12.4.18.45.29.07.45-.08 1.16-.48 1.6-.5.55-1.43.98-2.3.87-1.84-.25-4.36-1.6-6.02-4.03-.95-1.38-1.26-2.62-1.06-3.55.12-.6.4-1.08.47-1.19Z" fill="#fff" />
    </svg>;
  }
  if (channel === "facebook") {
    return <svg {...common}>
      <circle cx="12" cy="12" r="10" fill="#1877F2" />
      <path d="M13.4 22v-7.6h2.4l.4-2.8h-2.8V9.8c0-.8.25-1.4 1.4-1.4h1.5V5.9a19 19 0 0 0-2.2-.12c-2.15 0-3.63 1.32-3.63 3.73v2.08H8.07v2.8h2.43V22Z" fill="#fff" />
    </svg>;
  }
  return <svg {...common}>
    <defs><linearGradient id={`ms${id}`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#0099FF" /><stop offset=".6" stopColor="#A033FF" /><stop offset="1" stopColor="#FF5280" /></linearGradient></defs>
    <path d="M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.1 7.1v3.3l3-1.7c1.2.3 2.5.5 3.9.5 5.6 0 10-4.1 10-9.6S17.6 2 12 2Z" fill={`url(#ms${id})`} />
    <path d="m6.5 14.3 3-4.7 2.6 2 3.4-2-3 4.7-2.6-2-3.4 2Z" fill="#fff" />
  </svg>;
}
