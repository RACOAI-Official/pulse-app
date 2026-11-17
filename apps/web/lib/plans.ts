/** Plan tiers. The internal key "pro" is shown as "Business" (live subscriptions already carry it). */
export type PlanKey = "starter" | "pro" | "enterprise";

export const PLAN_KEYS: PlanKey[] = ["starter", "pro", "enterprise"];
export const PLAN_NAMES: Record<PlanKey, string> = { starter: "Starter", pro: "Business", enterprise: "Enterprise" };
export const PLAN_RANK: Record<PlanKey, number> = { starter: 1, pro: 2, enterprise: 3 };

export function planName(key: string | null | undefined): string {
  return key && key in PLAN_NAMES ? PLAN_NAMES[key as PlanKey] : key || "—";
}

type PlanCopy = { tagline: string; includes: string; features: string[]; featured?: boolean; website?: boolean };

/** Marketing copy for the plan cards. Prices and AI credits come from the API. */
export const PLAN_COPY: Record<PlanKey, PlanCopy> = {
  starter: {
    tagline: "For pages getting their first steady orders.",
    includes: "What you get",
    features: [
      "Messenger and Instagram in one inbox",
      "AI replies in Bangla, Banglish and English",
      "AI takes orders right inside the chat",
      "Product catalog up to 50 items",
      "Sales and orders dashboard",
      "1 team member",
    ],
  },
  pro: {
    tagline: "For shops ready to sell on their own website too.",
    includes: "Everything in Starter, plus",
    featured: true,
    website: true,
    features: [
      "WhatsApp, so all 3 channels in one inbox",
      "Automatic follow-ups and order confirmations",
      "Pathao auto-booking and return-loss tracking",
      "Comment auto-replies and customer broadcasts",
      "Full analytics and team performance",
      "3 team members",
    ],
  },
  enterprise: {
    tagline: "For brands running ads at high order volume.",
    includes: "Everything in Business, plus",
    features: [
      "Custom-designed website, not a template",
      "AI phone calls to confirm orders, with recordings",
      "Create, launch and track Meta ads",
      "Admin Agent: run your shop by chatting",
      "Daily chat summaries and activity log",
      "Unlimited team, priority support",
    ],
  },
};
