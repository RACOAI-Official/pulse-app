export type Currency = "USD" | "GBP" | "BDT";

export const CURRENCIES: Currency[] = ["BDT", "USD", "GBP"];
const STORAGE_KEY = "pulse-plan-currency";

/** Default pricing currency from the browser's timezone and languages: Bangladesh → BDT, UK → GBP, else USD. */
export function detectCurrency(): Currency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "USD" || saved === "GBP" || saved === "BDT") return saved;
  } catch {}
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const languages = typeof navigator === "undefined" ? [] : [...(navigator.languages || []), navigator.language].filter(Boolean);
  if (zone === "Asia/Dhaka" || languages.some(lang => /^bn\b|-BD$/i.test(lang))) return "BDT";
  if (zone === "Europe/London" || languages.some(lang => /^en-GB$/i.test(lang))) return "GBP";
  return "USD";
}

export function rememberCurrency(currency: Currency) {
  try { localStorage.setItem(STORAGE_KEY, currency); } catch {}
}

export function formatMoney(minor: number, currency: string) {
  const locale = currency === "BDT" ? "en-BD" : currency === "GBP" ? "en-GB" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
}
