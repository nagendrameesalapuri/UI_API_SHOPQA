import { z } from "zod";
import { decimalStringSchema, idSchema, timestampSchema } from "./common.schema";
import { reviewWithAuthorSchema } from "./review.schema";

export const productSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  short_desc: z.string().nullable(),
  price: decimalStringSchema,
  compare_price: decimalStringSchema.nullable(),
  cost_price: decimalStringSchema.nullable(),
  // Seeded products have an SKU; products created in the admin panel do not
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  category_id: idSchema,
  brand: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  stock: z.number().int().nonnegative(),
  low_stock_threshold: z.number().int(),
  weight: decimalStringSchema.nullable(),
  dimensions: z.unknown().nullable(),
  images: z.array(z.string()).nullable(),
  thumbnail: z.string().nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  avg_rating: decimalStringSchema,
  review_count: z.number().int().nonnegative(),
  sold_count: z.number().int().nonnegative(),
  meta_title: z.string().nullable(),
  meta_desc: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  specifications: z.record(z.string(), z.string()),
});

// Products in list/detail responses carry their category joined in
export const catalogProductSchema = productSchema.extend({
  category_name: z.string().min(1),
  category_slug: z.string().min(1),
});

export const productListResponseSchema = z.object({
  products: z.array(catalogProductSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export const relatedProductSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  price: decimalStringSchema,
  thumbnail: z.string().nullable(),
  avg_rating: decimalStringSchema,
  review_count: z.number().int().nonnegative(),
});

export const productDetailResponseSchema = z.object({
  product: catalogProductSchema.extend({
    variants: z.array(z.unknown()),
    reviews: z.array(reviewWithAuthorSchema),
    related: z.array(relatedProductSchema),
  }),
});

export const categorySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  parent_id: idSchema.nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  created_at: timestampSchema,
  product_count: decimalStringSchema,
});

export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema),
});

// POST/PUT /api/products (admin) return the bare product row
export const productWriteResponseSchema = z.object({
  product: productSchema.extend({
    category_name: z.string().optional(),
    category_slug: z.string().optional(),
  }),
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export type Category = z.infer<typeof categorySchema>;
