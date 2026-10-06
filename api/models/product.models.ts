import { ProductDetailResponse } from "../schemas/product.schema";

export type ProductSort =
  | "price_asc"
  | "price_desc"
  | "rating_desc"
  | "newest"
  | "popular"
  | "name_asc";

export interface GetProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  featured?: boolean;
  sort?: ProductSort;
}

// GET /api/products/:idOrSlug, inferred from the zod schema
export type ProductDetail = ProductDetailResponse["product"];
