import { redirect } from "next/navigation";

/** Billing moved to the Plan tab; keep old links and gateway returns working. */
export default async function BillingRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(query ? `/plan?${query}` : "/plan");
}
