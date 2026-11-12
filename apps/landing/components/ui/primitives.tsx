import React from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import PulseMark from './PulseMark';

type Channel = 'instagram' | 'messenger';

/** Pulse logo — the brand mark only (no wordmark; the hero carries the name). */
export function PulseLogo({ className = '', tone = 'brand' }: { className?: string; tone?: 'brand' | 'white' }) {
  return (
    <span className={`inline-flex items-center transition-colors duration-300 ${tone === 'white' ? 'text-white' : 'text-[#025b4f]'} ${className}`}>
      <PulseMark className="h-9 w-auto" />
    </span>
  );
}

/** Small app tile used inside the product mockups. */
export function PulseAppTile({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span aria-hidden className={`grid place-items-center rounded-[11px] bg-mint text-[#025b4f] ${className}`}>
      <PulseMark className="h-[55%] w-auto" />
    </span>
  );
}

export function ChannelIcon({ channel, className = 'h-4 w-4' }: { channel: Channel; className?: string }) {
  if (channel === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-label="Instagram" role="img">
        <defs>
          <radialGradient id="ig-g" cx="30%" cy="107%" r="150%">
            <stop offset="0" stopColor="#fdf497" />
            <stop offset=".05" stopColor="#fdf497" />
            <stop offset=".45" stopColor="#fd5949" />
            <stop offset=".6" stopColor="#d6249f" />
            <stop offset=".9" stopColor="#285AEB" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-g)" />
        <rect x="6.5" y="6.5" width="11" height="11" rx="5.5" fill="none" stroke="#fff" strokeWidth="1.8" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Messenger" role="img">
      <defs>
        <linearGradient id="ms-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0099FF" />
          <stop offset=".6" stopColor="#A033FF" />
          <stop offset="1" stopColor="#FF5280" />
        </linearGradient>
      </defs>
      <path d="M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.1 7.1v3.3l3-1.7c1.2.3 2.5.5 3.9.5 5.6 0 10-4.1 10-9.6S17.6 2 12 2Z" fill="url(#ms-g)" />
      <path d="m6.5 14.3 3-4.7 2.6 2 3.4-2-3 4.7-2.6-2-3.4 2Z" fill="#fff" />
    </svg>
  );
}

export function Avatar({ initials, tone = 0, className = 'h-8 w-8 text-[11px]' }: { initials: string; tone?: number; className?: string }) {
  const tones = ['bg-sage text-teal', 'bg-mint text-forest', 'bg-[#f2e9dc] text-[#6b4f2a]', 'bg-[#e4ecf5] text-[#2c4a6b]', 'bg-[#efe3ec] text-[#6b3a5c]'];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-semibold ${tones[tone % tones.length]} ${className}`}>
      {initials}
    </span>
  );
}

export function AITag({ label = 'AI', className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal ${className}`}>
      <Sparkles className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/** Marks any visual that is a reconstruction rather than a real screenshot. */
export function DemoLabel({ className = '', children = 'Illustrative demo · fictional data' }: { className?: string; children?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-forest/10 bg-white/85 px-2.5 py-1 text-[10px] font-medium tracking-wide text-ink-soft backdrop-blur ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-teal/60" aria-hidden />
      {children}
    </span>
  );
}

export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
      {children}
    </p>
  );
}

type CTAProps = {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'light';
  size?: 'md' | 'lg';
  className?: string;
};

/** Pill CTA with the original site's circular arrow treatment. */
export function CTAButton({ href, children, variant = 'primary', size = 'md', className = '' }: CTAProps) {
  const external = href.startsWith('http');
  const base =
    'group inline-flex items-center justify-between gap-3 rounded-full font-semibold transition-all duration-300 active:scale-[0.98] focus-visible:outline-offset-4';
  const sizes = size === 'lg' ? 'pl-7 pr-2 py-2 text-base md:text-lg' : 'pl-5 pr-1.5 py-1.5 text-[15px]';
  const variants = {
    primary: 'bg-forest text-white shadow-[0_10px_30px_-10px_rgba(11,79,75,0.6)] hover:bg-teal',
    secondary: 'bg-white/80 text-forest border border-forest/15 backdrop-blur hover:bg-white hover:border-forest/30',
    light: 'bg-white text-forest hover:bg-mint',
  }[variant];
  const circle = {
    primary: 'bg-brand text-forest',
    secondary: 'bg-mint text-teal',
    light: 'bg-forest text-white',
  }[variant];
  const circleSize = size === 'lg' ? 'h-11 w-11' : 'h-8 w-8';

  return (
    <a
      href={href}
      className={`${base} ${sizes} ${variants} ${className}`}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span>{children}</span>
      <span className={`grid ${circleSize} place-items-center rounded-full transition-transform duration-300 group-hover:rotate-45 ${circle}`}>
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </span>
      {external && <span className="sr-only">(opens in a new tab)</span>}
    </a>
  );
}
