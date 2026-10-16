export type Currency = "BDT" | "USD" | "EUR" | "GBP";
export type ProductState = "draft" | "active" | "archived";
export type OrderState = "draft" | "pending_confirmation" | "confirmed" | "processing" | "completed" | "cancelled";

export interface Variant {
  id: string;
  sku: string;
  options: Record<string, string>;
  regular_price_minor: number;
  offer_price_minor: number | null;
  stock: number;
  active: boolean;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  category: string;
  description: string;
  media: ({ path: string } | { url: string })[];
  delivery_minor: number | null;
  state: ProductState;
  product_variants: Variant[];
  updated_at: string;
}

export interface CommerceConfig { currency: Currency; currency_locked: boolean }

export interface OrderItem {
  id: string;
  variant_id: string;
  product_title: string;
  sku: string;
  options: Record<string, string>;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
}

export interface Payment {
  id: string;
  amount_minor: number;
  method: string;
  note: string;
  created_at: string;
}

export interface CommerceOrder {
  id: string;
  state: OrderState;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  currency_code: Currency;
  subtotal_minor: number;
  discount_type: "none" | "amount" | "percent";
  discount_value: number;
  discount_minor: number;
  delivery_minor: number;
  total_minor: number;
  paid_minor: number;
  refund_due_minor: number;
  created_at: string;
  commerce_order_items?: OrderItem[];
  commerce_payments?: Payment[];
}

export function money(minor: number, currency: Currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

export function toMinor(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a nonnegative amount with up to two decimal places.");
  return Math.round(Number(value) * 100);
}

export function decimal(minor: number | null | undefined) { return minor == null ? "" : (minor / 100).toFixed(2); }
