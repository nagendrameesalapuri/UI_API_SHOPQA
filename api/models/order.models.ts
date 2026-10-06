// Response types are inferred from the zod schemas so the two cannot drift apart
export type { Order, OrderDetail, OrderStatus } from "../schemas/order.schema";

// Request body for checkout (POST /api/orders)
export interface ShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}
