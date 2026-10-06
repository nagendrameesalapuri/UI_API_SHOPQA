// Response types are inferred from the zod schemas so the two cannot drift apart
export type { Cart, CartItem } from "../schemas/cart.schema";

// Amounts as shown in the cart's order summary
export interface CartTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}
