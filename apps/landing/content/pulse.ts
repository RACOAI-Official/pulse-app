/**
 * Pulse marketing site — single source of truth for copy, links and demo data.
 *
 * Every person, product, price and order below is FICTIONAL demonstration
 * content used to illustrate the workflow. Nothing here is real customer data.
 */

// ---------------------------------------------------------------------------
// Verified destinations (checked to return HTTP 200 when this file was written)
// ---------------------------------------------------------------------------
export const LINKS = {
  requestAccess: 'https://pulse.racoai.io/signup',
  signIn: 'https://pulse.racoai.io/login',
  bookDemo: 'https://racoai.io/contact',
  contact: 'https://racoai.io/contact',
  company: 'https://racoai.io',
  privacy: 'https://racoai.io/privacy-policy',
  terms: 'https://racoai.io/terms',
} as const;

// In-page anchors
export const ANCHORS = {
  top: 'top',
  product: 'product',
  features: 'features',
  howItWorks: 'how-it-works',
  useCases: 'use-cases',
  integrations: 'integrations',
  beta: 'beta',
  requestAccess: 'request-access',
} as const;

export const NAV = [
  { label: 'Product', href: `#${ANCHORS.product}` },
  { label: 'How It Works', href: `#${ANCHORS.howItWorks}` },
  { label: 'Features', href: `#${ANCHORS.features}`, dropdown: 'features' as const },
  { label: 'Use Cases', href: `#${ANCHORS.useCases}` },
];

// ---------------------------------------------------------------------------
// Demo world — one consistent fictional merchant, customer, product and order
// ---------------------------------------------------------------------------
export const CURRENCY = 'Tk';
export const money = (n: number) => `${CURRENCY} ${n.toLocaleString('en-US')}`;

export const DEMO = {
  merchant: 'Nook & Thread',
  customer: { name: 'Nadia Rahman', initials: 'NR', handle: '@nadia.rhmn', channel: 'instagram' as const },
  product: {
    name: 'Cloud Canvas Sneakers',
    variant: 'White · Size 39',
    price: 3450,
    stock: 12,
    img: '/media/products/sneakers-white.webp',
    sizes: ['37', '38', '39', '40', '41'],
  },
  delivery: { label: 'Inside Dhaka', fee: 80, eta: '2–3 days' },
  order: {
    id: 'PL-1042',
    address: 'House 12, Road 5, Dhanmondi, Dhaka',
    phone: '01X-XXXX-1042',
    payment: 'Cash on delivery',
  },
};
export const ORDER_TOTAL = DEMO.product.price + DEMO.delivery.fee;

/** The scripted conversation reused by the hero, showcase and workflow. */
export const CONVERSATION = [
  { from: 'customer' as const, text: 'Hi! Are the Cloud Canvas sneakers available in size 39? How much with delivery?' },
  {
    from: 'ai' as const,
    text: `Yes — white in size 39 is in stock. They're ${money(DEMO.product.price)}, plus ${money(DEMO.delivery.fee)} delivery inside Dhaka (${DEMO.delivery.eta}). Want me to reserve a pair?`,
    attachProduct: true,
  },
  { from: 'customer' as const, text: `Yes please! Cash on delivery to ${DEMO.order.address}.` },
  { from: 'ai' as const, text: `Done — I've drafted order ${DEMO.order.id} for ${money(ORDER_TOTAL)}. Our team will confirm it shortly.` },
];

export const CATALOG = [
  { name: 'Cloud Canvas Sneakers', img: '/media/products/sneakers-white.webp', price: 3450, stock: 12, variants: '5 sizes' },
  { name: 'Minimal Desk Set', img: '/media/products/object.webp', price: 1650, stock: 9, variants: '4 pieces' },
  { name: 'Colour Block Tote', img: '/media/products/tote.webp', price: 1850, stock: 24, variants: '3 colours' },
  { name: 'Mini Bloom Vase', img: '/media/products/vase.webp', price: 690, stock: 58, variants: 'One size' },
  { name: 'Cube Desk Clock', img: '/media/products/clock.webp', price: 1250, stock: 31, variants: '2 finishes' },
  { name: 'Pastel Lounge Chair', img: '/media/products/chair.webp', price: 8900, stock: 3, variants: '2 colours' },
  { name: 'Orbit Speaker', img: '/media/products/speaker.webp', price: 4200, stock: 0, variants: 'Matte black' },
  { name: 'Glossy Shopper Set', img: '/media/products/totes.webp', price: 2400, stock: 15, variants: 'Set of 3' },
];

export const INBOX_THREADS = [
  { name: DEMO.customer.name, initials: DEMO.customer.initials, channel: 'instagram' as const, preview: 'Yes please! Cash on delivery to…', time: 'now', status: 'AI', unread: true },
  { name: 'Tanvir Hasan', initials: 'TH', channel: 'messenger' as const, preview: 'Is the tote available in sand?', time: '2m', status: 'AI', unread: true },
  { name: 'Mehjabin K.', initials: 'MK', channel: 'instagram' as const, preview: 'Can I exchange for size 40?', time: '9m', status: 'Team', unread: false },
  { name: 'Rafiul Islam', initials: 'RI', channel: 'messenger' as const, preview: 'Delivery charge outside Dhaka?', time: '14m', status: 'AI', unread: false },
  { name: 'Sumaiya A.', initials: 'SA', channel: 'messenger' as const, preview: 'Thanks, order received 🙏', time: '1h', status: 'Closed', unread: false },
];

export const ORDERS = [
  { id: DEMO.order.id, customer: DEMO.customer.name, items: 'Cloud Canvas Sneakers ×1', total: ORDER_TOTAL, status: 'Draft', ai: true },
  { id: 'PL-1041', customer: 'Tanvir Hasan', items: 'Colour Block Tote ×2', total: 3780, status: 'Confirmed', ai: true },
  { id: 'PL-1040', customer: 'Rafiul Islam', items: 'Cube Desk Clock ×1', total: 1380, status: 'Shipped', ai: false },
  { id: 'PL-1039', customer: 'Sumaiya A.', items: 'Mini Bloom Vase ×3', total: 2150, status: 'Delivered', ai: true },
];

/** Illustrative chart series — demo numbers, not real usage. */
export const ANALYTICS = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  conversations: [42, 55, 48, 63, 71, 88, 64],
  aiReplies: [30, 41, 36, 49, 57, 70, 51],
  teamReplies: [12, 14, 12, 14, 14, 18, 13],
  stats: [
    { label: 'Conversations', value: '431' },
    { label: 'AI replies', value: '334' },
    { label: 'Confirmed orders', value: '57' },
    { label: 'Order value', value: money(184300) },
  ],
};

// ---------------------------------------------------------------------------
// Section copy
// ---------------------------------------------------------------------------
export const HERO = {
  headline: ['From message to order.', 'Automatically.'],
  body: 'Pulse brings your customer conversations, AI sales assistant, products, and orders into one intelligent workspace.',
  primary: { label: 'Request beta access', href: LINKS.requestAccess },
  secondary: { label: 'See how it works', href: `#${ANCHORS.howItWorks}` },
  floating: {
    product: 'Matched from catalogue',
    order: 'Order draft created',
    stat: 'Replied by AI today',
  },
};

export const CHAOS = {
  eyebrow: 'What is Pulse',
  headline: 'Your business happens in conversations. Pulse brings it all together.',
  story: {
    label: 'Customers message you. Pulse answers and drafts the order.',
    beats: [
      { lead: 'Customers', tail: 'message you', chip: 'Size 39 in stock?' },
      { lead: 'Pulse', tail: 'answers', chip: 'Yes! Tk 3,450' },
      { lead: 'and drafts', tail: 'the order.', chip: '#PL-1042' },
    ],
    sub: 'Pulse is the AI sales assistant for Messenger and Instagram. It replies from your catalogue, turns chats into orders, and keeps every customer in one workspace.',
  },
  problems: [
    'Messages scattered across Messenger and Instagram',
    'The same price, stock and delivery questions — all day',
    'Orders copied by hand from chat to notebook',
    'Enquiries missed after hours',
    'No clear view of who bought what',
  ],
  resolved: 'One workspace. Every conversation, product and order in its place.',
  fragments: [
    { kind: 'msg', text: 'How much is this one?', channel: 'instagram' },
    { kind: 'img', src: '/media/products/tote.webp', label: 'Colour Block Tote' },
    { kind: 'msg', text: 'Do you have size 40?', channel: 'messenger' },
    { kind: 'order', text: '2× Tote · COD · Mirpur', label: 'Written in a notebook' },
    { kind: 'img', src: '/media/products/vase.webp', label: 'Mini Bloom Vase' },
    { kind: 'missed', text: '14 unread enquiries', label: 'Since 11:00 PM' },
    { kind: 'msg', text: 'Delivery charge outside Dhaka?', channel: 'messenger' },
    { kind: 'img', src: '/media/products/clock.webp', label: 'Cube Desk Clock' },
    { kind: 'msg', text: 'Is this still available??', channel: 'instagram' },
    { kind: 'img', src: '/media/products/sneakers-white.webp', label: 'Cloud Canvas Sneakers' },
    { kind: 'order', text: 'Vase ×3 · bKash?', label: 'Screenshot in gallery' },
    { kind: 'img', src: '/media/products/chair.webp', label: 'Pastel Lounge Chair' },
  ],
};

export type ShowcaseTabId = 'inbox' | 'ai-setup' | 'catalog' | 'orders' | 'analytics';

export const SHOWCASE: {
  headline: string;
  sub: string;
  tabs: { id: ShowcaseTabId; label: string; summary: string; points: { title: string; desc: string }[] }[];
} = {
  headline: 'One workspace. Everything connected.',
  sub: 'Every part of Pulse shares the same customers, products and orders — so nothing gets copied twice.',
  tabs: [
    {
      id: 'inbox',
      label: 'Inbox',
      summary: 'Messenger and Instagram in one inbox',
      points: [
        { title: 'One unified inbox', desc: 'Facebook Messenger and Instagram conversations side by side, filtered by channel or status.' },
        { title: 'AI replies, clearly labelled', desc: 'See which messages Pulse answered and which your team handled.' },
        { title: 'Human takeover', desc: 'Pause the AI on any conversation and reply yourself — in one click.' },
      ],
    },
    {
      id: 'ai-setup',
      label: 'AI Setup',
      summary: 'Teach Pulse how your business works',
      points: [
        { title: 'Business knowledge', desc: 'Add your FAQs, policies, delivery rules and tone of voice.' },
        { title: 'Private testing', desc: 'Chat with your agent privately before customers ever see it.' },
        { title: 'Publish when ready', desc: 'Go live on your channels only when you are happy with the answers.' },
      ],
    },
    {
      id: 'catalog',
      label: 'Catalog',
      summary: 'Products Pulse can actually quote',
      points: [
        { title: 'Products with images', desc: 'Prices, variants and photos the AI uses to answer accurately.' },
        { title: 'Live stock', desc: 'Pulse knows what is available — and what is sold out.' },
        { title: 'Variants that make sense', desc: 'Sizes, colours and options that map straight into orders.' },
      ],
    },
    {
      id: 'orders',
      label: 'Orders',
      summary: 'AI-drafted orders your team approves',
      points: [
        { title: 'AI order drafts', desc: 'When a customer is ready to buy, Pulse drafts the order from the chat.' },
        { title: 'Review and confirm', desc: 'Your team checks details, confirms and records payment.' },
        { title: 'Fulfilment status', desc: 'Track each order from draft to delivered, with courier details.' },
      ],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      summary: 'See what conversations are worth',
      points: [
        { title: 'Conversation activity', desc: 'Message volume across channels, day by day.' },
        { title: 'AI vs team replies', desc: 'Understand how much work Pulse handles for your team.' },
        { title: 'Orders and sales', desc: 'Confirmed orders and order value, in one simple report.' },
      ],
    },
  ],
};

export const WORKFLOW = {
  eyebrow: 'How it works',
  headline: 'See how a conversation becomes an order.',
  steps: [
    { step: '01', category: 'Customer asks', title: 'A question arrives', description: `${DEMO.customer.name} messages ${DEMO.merchant} on Instagram asking about the ${DEMO.product.name} in size 39.` },
    { step: '02', category: 'Pulse quotes', title: 'Pulse answers', description: 'Pulse checks the catalogue and delivery rules, then replies with the price, stock and delivery fee — in seconds.' },
    { step: '03', category: 'Pulse drafts', title: 'An order is drafted', description: `Nadia says yes and shares her address. Pulse creates AI-tagged draft ${DEMO.order.id} with every detail filled in.` },
    { step: '04', category: 'Team reviews', title: 'Your team confirms', description: 'The merchant reviews the draft, confirms the order and moves it into fulfilment.' },
  ],
};

export type UseCaseId = 'answer' | 'cod' | 'manage' | 'takeover' | 'sales';
export const USE_CASES: { headline: string; sub: string; items: { id: UseCaseId; name: string; desc: string }[] } = {
  headline: 'Less busywork. More business.',
  sub: 'Built for merchants who sell through social conversations every day.',
  items: [
    { id: 'answer', name: 'Answer product questions', desc: 'Pulse replies to availability and price questions using your catalogue.' },
    { id: 'cod', name: 'Capture cash-on-delivery orders', desc: 'Customer details are collected in chat and turned into a draft order.' },
    { id: 'manage', name: 'Manage customer conversations', desc: 'Filter by channel, see history and keep every status up to date.' },
    { id: 'takeover', name: 'Take over when it matters', desc: 'Switch from AI to a teammate the moment a conversation needs a human.' },
    { id: 'sales', name: 'Understand your sales activity', desc: 'Message volume, orders and value — without building a spreadsheet.' },
  ],
};

export const CLOSING = {
  headline: ['Your next order could', 'start with a message.'],
  body: 'Give your team one place to manage conversations, assist customers, and turn enquiries into sales.',
  primary: { label: 'Request beta access', href: LINKS.requestAccess },
  secondary: { label: 'Book a demo', href: LINKS.bookDemo },
};

export const BETA = {
  title: 'Pulse is in beta',
  body: 'Here is exactly what you can use today — and what is still being built.',
  available: ['Messenger & Instagram inbox', 'AI replies from your knowledge & catalogue', 'Human takeover', 'Product catalogue & stock', 'AI order drafts & order management', 'Customers & history', 'Analytics', 'Team activity'],
  comingLater: ['AI Calls & Recordings', 'Broadcast', 'Chat Summary', 'AdsFlow, Creative Studio & Ad Launcher'],
  note: 'Additional integrations require configuration and verification during beta.',
};

export const FOOTER = {
  tagline: 'The AI-powered workspace for social commerce — conversations, products and orders in one place.',
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Overview', href: `#${ANCHORS.product}` },
        { label: 'Features', href: `#${ANCHORS.features}` },
        { label: 'Integrations', href: `#${ANCHORS.integrations}` },
        { label: 'Beta status', href: `#${ANCHORS.beta}` },
      ],
    },
    {
      title: 'Get started',
      links: [
        { label: 'Request beta access', href: LINKS.requestAccess, external: true },
        { label: 'Sign in', href: LINKS.signIn, external: true },
        { label: 'Book a demo', href: LINKS.bookDemo, external: true },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'RACO AI Technologies', href: LINKS.company, external: true },
        { label: 'Contact', href: LINKS.contact, external: true },
        { label: 'Privacy', href: LINKS.privacy, external: true },
        { label: 'Terms', href: LINKS.terms, external: true },
      ],
    },
  ],
};
