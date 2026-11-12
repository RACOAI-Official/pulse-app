import React from 'react';
import { FOOTER, LINKS } from '@/content/pulse';
import PulseMark from '../ui/PulseMark';

export default function Footer() {
  return (
    <footer className="relative overflow-hidden rounded-t-[2.5rem] bg-mesh-deep pb-8 pt-20 text-white">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="mb-20 grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="flex flex-col gap-5 md:col-span-5">
            <PulseMark className="h-12 w-auto text-white" title="Pulse" />
            <p className="max-w-sm leading-relaxed text-white/75">{FOOTER.tagline}</p>
            <p className="text-sm text-white/60">
              Pulse by{' '}
              <a href={LINKS.company} target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline-offset-4 hover:underline">
                RACO AI Technologies
              </a>
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7">
            {FOOTER.columns.map((col) => (
              <div key={col.title} className="flex flex-col gap-3.5">
                <h3 className="mb-1 text-sm font-semibold uppercase tracking-[0.14em] text-brand">{col.title}</h3>
                {col.links.map((l) => {
                  const external = 'external' in l && l.external;
                  return (
                    <a
                      key={l.label}
                      href={l.href}
                      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="w-fit rounded text-white/75 transition-colors hover:text-white"
                    >
                      {l.label}
                      {external && <span aria-hidden className="ml-1 text-white/40">↗</span>}
                      {external && <span className="sr-only"> (opens in a new tab)</span>}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div aria-hidden className="flex select-none justify-center border-t border-white/10 pt-12 text-white/[0.07]">
          <PulseMark className="h-auto w-[46vw] max-w-[560px]" />
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-sm text-white/55 sm:flex-row">
          <p>© {new Date().getFullYear()} RACO AI Technologies. Pulse is in beta.</p>
          <p>Product visuals on this site are illustrative and use fictional demo data.</p>
        </div>
      </div>
    </footer>
  );
}
