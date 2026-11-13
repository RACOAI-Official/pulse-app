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
  /** Short-lived signed link to the first photo, added by the product list. */
  cover_url?: string | null;
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
  archived_at?: string | null;
  conversation_id?: string | null;
  customer_id?: string | null;
  source?: "staff" | "agent";
  seen_at?: string | null;
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

export const couriers = { pathao: "Pathao", steadfast: "Steadfast", redx: "RedX", paperfly: "Paperfly", ecourier: "eCourier", sundarban: "Sundarban Courier", own_rider: "Own delivery rider", other: "Other" } as const;
export type Courier = keyof typeof couriers;
export const courierLabel = (courier: string, name?: string | null) => courier === "other" && name ? name : couriers[courier as Courier] || courier;

export interface Shipment {
  id: string;
  provider: Courier;
  courier_name: string | null;
  tracking_code: string | null;
  state: "pending" | "booked" | "picked_up" | "in_transit" | "delivered" | "returned" | "failed" | "review";
  cod_minor: number;
  delivery_fee_minor: number | null;
  damage_loss_minor: number;
  return_note: string | null;
  returned_at: string | null;
  commerce_shipment_return_items?: { order_item_id: string; damaged_quantity: number }[];
}
