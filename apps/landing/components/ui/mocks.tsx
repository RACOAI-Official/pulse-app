/**
 * Illustrative reconstructions of the Pulse beta interface.
 * They are built from the product specification (no authenticated screenshots
 * were available) and use fictional demo data from content/pulse.ts.
 */
import React from 'react';
import {
  BarChart3, BookOpen, Check, CheckCheck, FlaskConical, Hand, Inbox, ListFilter, Package,
  ReceiptText, Rocket, Search, Send, Settings, Sparkles, Truck, Users, Banknote, MapPin,
} from 'lucide-react';
import { AITag, Avatar, ChannelIcon, PulseAppTile } from './primitives';
import { ANALYTICS, CATALOG, CONVERSATION, DEMO, INBOX_THREADS, ORDERS, ORDER_TOTAL, money } from '@/content/pulse';

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
export function ChatBubble({ from, children, className = '' }: { from: 'customer' | 'ai' | 'team'; children: React.ReactNode; className?: string }) {
  if (from === 'customer') {
    return (
      <div className={`flex items-end gap-2 ${className}`}>
        <Avatar initials={DEMO.customer.initials} className="h-6 w-6 text-[9px]" />
        <div className="max-w-[82%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-[13px] leading-snug text-forest shadow-[0_1px_2px_rgba(21,59,55,0.08)] ring-1 ring-forest/5">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <div
        className={`max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13px] leading-snug ${
          from === 'ai' ? 'bg-teal text-white' : 'bg-sage text-forest'
        }`}
      >
        {children}
      </div>
      <span className="flex items-center gap-1 text-[10px] text-ink-faint">
        {from === 'ai' ? <AITag label="Pulse AI" className="!py-0 !text-[9px]" /> : <span className="font-medium">Ayesha · Team</span>}
        <CheckCheck className="h-3 w-3 text-teal" aria-hidden />
      </span>
    </div>
  );
}

export function TypingDots() {
  return (
    <div className="flex justify-end">
      <div className="flex gap-1 rounded-2xl rounded-br-md bg-teal/90 px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function ProductQuoteCard({ className = '' }: { className?: string }) {
  const p = DEMO.product;
  return (
    <div className={`flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-4 shadow-soft ring-1 ring-forest/5 ${className}`}>
      <img src={p.img} alt="" className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-forest">{p.name}</p>
        <p className="text-[11px] text-ink-soft">{p.variant}</p>
        <p className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-[12px]">
          <span className="font-semibold text-forest">{money(p.price)}</span>
          <span className="inline-flex items-center gap-1 text-teal">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" /> {p.stock} in stock
          </span>
        </p>
      </div>
    </div>
  );
}

export function OrderDraftCard({ state = 'draft', className = '', compact = false }: { state?: 'draft' | 'confirmed'; className?: string; compact?: boolean }) {
  const p = DEMO.product;
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-soft ring-1 ring-forest/5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Order</p>
          <p className="font-display text-[17px] font-semibold text-forest">#{DEMO.order.id}</p>
        </div>
        {state === 'draft' ? (
          <AITag label="AI draft" />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-teal px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            <Check className="h-3 w-3" aria-hidden /> Confirmed
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-paper p-2">
        <img src={p.img} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-forest">{p.name} ×1</p>
          <p className="text-[11px] text-ink-soft">{p.variant}</p>
        </div>
        <p className="text-[12px] font-semibold text-forest">{money(p.price)}</p>
      </div>
      {!compact && (
        <dl className="mt-3 space-y-1.5 text-[11.5px]">
          <div className="flex items-center gap-2 text-ink-soft">
            <Avatar initials={DEMO.customer.initials} className="h-5 w-5 text-[8px]" />
            <dd className="font-medium text-forest">{DEMO.customer.name}</dd>
            <ChannelIcon channel="instagram" className="ml-auto h-3.5 w-3.5" />
          </div>
          <div className="flex items-start gap-2 text-ink-soft">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <dd className="leading-snug">{DEMO.order.address}</dd>
          </div>
          <div className="flex items-center gap-2 text-ink-soft">
            <Banknote className="h-3.5 w-3.5" aria-hidden />
            <dd>{DEMO.order.payment}</dd>
            <span className="ml-auto">Delivery {money(DEMO.delivery.fee)}</span>
          </div>
        </dl>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[11px] text-ink-soft">Total</span>
        <span className="font-display text-[17px] font-semibold text-forest">{money(ORDER_TOTAL)}</span>
      </div>
      {state === 'draft' ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold">
          <span className="rounded-full border border-forest/15 py-1.5 text-center text-forest">Edit</span>
          <span className="rounded-full bg-forest py-1.5 text-center text-white">Confirm order</span>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-mint/70 px-3 py-2 text-[11.5px] text-forest">
          <Truck className="h-4 w-4 text-teal" aria-hidden />
          Ready for courier pickup
        </div>
      )}
    </div>
  );
}

export function MiniStat({ label, value, trend, className = '' }: { label: string; value: string; trend?: string; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-forest/5 ${className}`}>
      <p className="text-[10.5px] font-medium text-ink-soft">{label}</p>
      <p className="mt-0.5 font-display text-[22px] font-semibold leading-none text-forest">{value}</p>
      {trend && <p className="mt-1 text-[10.5px] font-medium text-teal">{trend}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App chrome
// ---------------------------------------------------------------------------
const RAIL = [
  { icon: Inbox, key: 'inbox' },
  { icon: Users, key: 'customers' },
  { icon: Package, key: 'catalog' },
  { icon: ReceiptText, key: 'orders' },
  { icon: BarChart3, key: 'analytics' },
  { icon: Sparkles, key: 'ai-setup' },
];

export function AppFrame({ active, title, children, className = '' }: { active: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`@container flex h-full w-full overflow-hidden rounded-[inherit] bg-[#f6f9f6] text-forest ${className}`}>
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-white py-3 @md:flex">
        <PulseAppTile className="mb-2 h-8 w-8" />
        {RAIL.map(({ icon: Icon, key }) => (
          <span key={key} className={`grid h-9 w-9 place-items-center rounded-xl ${active === key ? 'bg-mint text-teal' : 'text-ink-faint'}`}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        ))}
        <span className="mt-auto grid h-9 w-9 place-items-center text-ink-faint">
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white/80 px-4 py-2.5">
          <p className="font-display text-[15px] font-semibold">{title}</p>
          <span className="ml-auto hidden items-center gap-2 rounded-full bg-paper px-3 py-1.5 text-[11px] text-ink-faint ring-1 ring-line @lg:flex">
            <Search className="h-3.5 w-3.5" aria-hidden /> Search
          </span>
          <Avatar initials="AY" tone={1} className="h-7 w-7 text-[10px]" />
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature panels (Product showcase tabs)
// ---------------------------------------------------------------------------
export function ThreadList({ activeIndex = 0, className = '' }: { activeIndex?: number; className?: string }) {
  return (
    <div className={`flex h-full flex-col border-r border-line bg-white ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-medium">
        <span className="rounded-full bg-forest px-2.5 py-1 text-white">All</span>
        <span className="flex items-center gap-1 rounded-full px-2 py-1 text-ink-soft ring-1 ring-line">
          <ChannelIcon channel="messenger" className="h-3 w-3" /> Messenger
        </span>
        <span className="flex items-center gap-1 rounded-full px-2 py-1 text-ink-soft ring-1 ring-line">
          <ChannelIcon channel="instagram" className="h-3 w-3" /> Instagram
        </span>
        <ListFilter className="ml-auto h-3.5 w-3.5 text-ink-faint" aria-hidden />
      </div>
      <ul className="flex-1 overflow-hidden">
        {INBOX_THREADS.map((t, i) => (
          <li key={t.name} className={`flex items-center gap-2.5 border-b border-line/70 px-3 py-2.5 ${i === activeIndex ? 'bg-mint/60' : ''}`}>
            <span className="relative">
              <Avatar initials={t.initials} tone={i} />
              <ChannelIcon channel={t.channel} className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className={`truncate text-[12px] ${t.unread ? 'font-semibold' : 'font-medium'}`}>{t.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{t.time}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[11px] text-ink-soft">{t.preview}</span>
                <span
                  className={`ml-auto shrink-0 rounded-full px-1.5 text-[9px] font-semibold ${
                    t.status === 'AI' ? 'bg-mint text-teal' : t.status === 'Team' ? 'bg-sage text-forest' : 'bg-paper text-ink-faint ring-1 ring-line'
                  }`}
                >
                  {t.status}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConversationPane({ upto = CONVERSATION.length, takeover = false, className = '' }: { upto?: number; takeover?: boolean; className?: string }) {
  return (
    <div className={`flex h-full min-w-0 flex-col ${className}`}>
      <div className="flex items-center gap-2 border-b border-line bg-white/70 px-4 py-2">
        <Avatar initials={DEMO.customer.initials} className="h-7 w-7 text-[10px]" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            {DEMO.customer.name} <ChannelIcon channel="instagram" className="h-3.5 w-3.5" />
          </p>
          <p className="text-[10px] text-ink-faint">{takeover ? 'Ayesha took over · AI paused' : 'AI is replying'}</p>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${
            takeover ? 'bg-forest text-white' : 'bg-white text-forest ring-1 ring-forest/15'
          }`}
        >
          <Hand className="h-3 w-3" aria-hidden /> {takeover ? 'You’re replying' : 'Take over'}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden p-4">
        {CONVERSATION.slice(0, upto).map((m, i) => (
          <React.Fragment key={i}>
            <ChatBubble from={m.from}>{m.text}</ChatBubble>
            {'attachProduct' in m && m.attachProduct && <ProductQuoteCard className="ml-auto w-[min(260px,85%)]" />}
          </React.Fragment>
        ))}
        {takeover && <ChatBubble from="team">Hi Nadia, it’s Ayesha — I’ll gift-wrap these for you 🎁</ChatBubble>}
      </div>
      <div className="m-3 mt-0 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11.5px] text-ink-faint ring-1 ring-line">
        {takeover ? 'Reply as Ayesha…' : 'Pulse AI is handling this conversation'}
        <Send className="ml-auto h-3.5 w-3.5 text-teal" aria-hidden />
      </div>
    </div>
  );
}

export function InboxMock({ takeover = false }: { takeover?: boolean }) {
  return (
    <AppFrame active="inbox" title="Inbox">
      <div className="flex h-full">
        <ThreadList className="hidden w-[42%] max-w-[300px] @2xl:flex" />
        <ConversationPane takeover={takeover} upto={takeover ? 3 : 4} className="flex-1" />
      </div>
    </AppFrame>
  );
}

export function AISetupMock() {
  const sources = [
    { icon: BookOpen, label: 'Business info', meta: 'Hours, location, tone' },
    { icon: FileTextIcon, label: 'FAQs', meta: '24 answers' },
    { icon: Truck, label: 'Delivery & returns policy', meta: 'Inside / outside Dhaka' },
    { icon: Package, label: 'Product catalogue', meta: `${CATALOG.length} products · synced` },
  ];
  return (
    <AppFrame active="ai-setup" title="AI agent">
      <div className="grid h-full grid-cols-1 gap-3 p-4 @2xl:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-mint text-teal">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-[13px] font-semibold">Sales assistant</p>
                <p className="text-[11px] text-ink-soft">Tone: friendly &amp; concise</p>
              </div>
              <span className="ml-auto rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink-soft ring-1 ring-line">Draft</span>
            </div>
          </div>
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Knowledge</p>
          {sources.map(({ icon: Icon, label, meta }) => (
            <div key={label} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-line">
              <Icon className="h-4 w-4 text-teal" aria-hidden />
              <span className="text-[12.5px] font-medium">{label}</span>
              <span className="ml-auto text-[11px] text-ink-soft">{meta}</span>
              <Check className="h-3.5 w-3.5 text-teal" aria-hidden />
            </div>
          ))}
        </div>
        <div className="hidden flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line @2xl:flex">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11.5px] font-semibold">
            <FlaskConical className="h-3.5 w-3.5 text-teal" aria-hidden /> Private test chat
            <span className="ml-auto text-[10px] font-medium text-ink-faint">Only you can see this</span>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-2.5 bg-paper p-3">
            <ChatBubble from="customer">Do you deliver outside Dhaka?</ChatBubble>
            <ChatBubble from="ai">Yes! Delivery outside Dhaka is Tk 150 and takes 3–5 days.</ChatBubble>
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="text-[11px] text-ink-soft">Happy with the answers?</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-forest px-3 py-1.5 text-[11px] font-semibold text-white">
              <Rocket className="h-3 w-3" aria-hidden /> Publish agent
            </span>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M9 13h6M9 17h4" />
    </svg>
  );
}

export function CatalogMock() {
  return (
    <AppFrame active="catalog" title="Catalogue">
      <div className="h-full overflow-hidden p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px]">
          <span className="rounded-full bg-forest px-2.5 py-1 font-medium text-white">All products</span>
          <span className="rounded-full px-2.5 py-1 text-ink-soft ring-1 ring-line">In stock</span>
          <span className="rounded-full px-2.5 py-1 text-ink-soft ring-1 ring-line">Low stock</span>
          <span className="ml-auto hidden rounded-full bg-mint px-2.5 py-1 font-semibold text-teal @lg:inline">+ Add product</span>
        </div>
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @3xl:grid-cols-4">
          {CATALOG.map((p) => (
            <div key={p.name} className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
              <div className="relative aspect-[4/3] bg-paper">
                <img src={p.img} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                    p.stock === 0 ? 'bg-white text-[#9a3b2f]' : p.stock < 5 ? 'bg-white text-[#8a6116]' : 'bg-white text-teal'
                  }`}
                >
                  {p.stock === 0 ? 'Sold out' : `${p.stock} in stock`}
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-[12px] font-semibold">{p.name}</p>
                <p className="flex items-center justify-between text-[11px] text-ink-soft">
                  {p.variants}
                  <span className="font-semibold text-forest">{money(p.price)}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

const STATUS_STYLE: Record<string, string> = {
  Draft: 'bg-mint text-teal',
  Confirmed: 'bg-sage text-forest',
  Shipped: 'bg-[#e9f0f7] text-[#2c4a6b]',
  Delivered: 'bg-forest text-white',
};

export function OrdersMock() {
  return (
    <AppFrame active="orders" title="Orders">
      <div className="grid h-full grid-cols-1 gap-3 p-4 @3xl:grid-cols-[1.35fr_1fr]">
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
          <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint @lg:grid-cols-[0.7fr_1fr_1.3fr_0.8fr_auto]">
            <span>Order</span>
            <span className="hidden @lg:block">Customer</span>
            <span className="hidden @lg:block">Items</span>
            <span className="hidden @lg:block">Total</span>
            <span>Status</span>
          </div>
          {ORDERS.map((o, i) => (
            <div
              key={o.id}
              className={`grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line/70 px-3 py-2.5 text-[11.5px] @lg:grid-cols-[0.7fr_1fr_1.3fr_0.8fr_auto] ${i === 0 ? 'bg-mint/50' : ''}`}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                #{o.id} {o.ai && <Sparkles className="h-3 w-3 text-teal" aria-label="AI-created" />}
              </span>
              <span className="hidden truncate @lg:block">{o.customer}</span>
              <span className="hidden truncate text-ink-soft @lg:block">{o.items}</span>
              <span className="hidden font-medium @lg:block">{money(o.total)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[o.status]}`}>{o.status}</span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 p-3 text-[10.5px] text-ink-soft">
            <span className="rounded-full px-2 py-1 ring-1 ring-line">Payment: recorded</span>
            <span className="rounded-full px-2 py-1 ring-1 ring-line">Courier: assigned</span>
          </div>
        </div>
        <OrderDraftCard className="hidden @3xl:block" />
      </div>
    </AppFrame>
  );
}

export function LineChart({ className = '' }: { className?: string }) {
  const w = 320;
  const h = 120;
  const max = Math.max(...ANALYTICS.conversations) * 1.1;
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h + 18}`} className={`w-full ${className}`} role="img" aria-label="Illustrative chart of conversations and AI replies over a week">
      <defs>
        <linearGradient id="area-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b4f4b" stopOpacity="0.18" />
          <stop offset="1" stopColor="#0b4f4b" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="#dbe7e2" strokeDasharray="3 4" />
      ))}
      <polygon points={`0,${h} ${pts(ANALYTICS.conversations)} ${w},${h}`} fill="url(#area-g)" />
      <polyline points={pts(ANALYTICS.conversations)} fill="none" stroke="#0b4f4b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts(ANALYTICS.aiReplies)} fill="none" stroke="#9cc7bb" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
      {ANALYTICS.days.map((d, i) => (
        <text key={d} x={(i / (ANALYTICS.days.length - 1)) * (w - 16) + 8} y={h + 15} fontSize="9" fill="#6d837f" textAnchor="middle">
          {d}
        </text>
      ))}
    </svg>
  );
}

export function AnalyticsMock() {
  const total = ANALYTICS.aiReplies.reduce((a, b) => a + b, 0) + ANALYTICS.teamReplies.reduce((a, b) => a + b, 0);
  const aiShare = Math.round((ANALYTICS.aiReplies.reduce((a, b) => a + b, 0) / total) * 100);
  return (
    <AppFrame active="analytics" title="Analytics · last 7 days">
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {ANALYTICS.stats.map((s) => (
            <MiniStat key={s.label} label={s.label} value={s.value} className="!shadow-none" />
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @2xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <div className="mb-2 flex items-center gap-3 text-[11px]">
              <span className="font-semibold">Conversations</span>
              <span className="flex items-center gap-1 text-ink-soft"><span className="h-0.5 w-3 bg-teal" /> All</span>
              <span className="flex items-center gap-1 text-ink-soft"><span className="h-0.5 w-3 bg-[#9cc7bb]" /> AI replies</span>
            </div>
            <LineChart />
          </div>
          <div className="hidden flex-col justify-between rounded-2xl bg-white p-4 ring-1 ring-line @2xl:flex">
            <p className="text-[11px] font-semibold">Who replied</p>
            <div className="my-3 flex h-3 overflow-hidden rounded-full bg-sage">
              <span className="bg-teal" style={{ width: `${aiShare}%` }} />
            </div>
            <div className="space-y-1.5 text-[11.5px]">
              <p className="flex justify-between"><span className="text-ink-soft">Pulse AI</span><span className="font-semibold">{aiShare}%</span></p>
              <p className="flex justify-between"><span className="text-ink-soft">Team</span><span className="font-semibold">{100 - aiShare}%</span></p>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
