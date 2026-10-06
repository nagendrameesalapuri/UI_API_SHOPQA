import { APIRequestContext, APIResponse } from "@playwright/test";
import { GetProductsQuery, ProductDetail } from "../models/product.models";
import {
  categoriesResponseSchema,
  Category,
  productDetailResponseSchema,
  ProductListResponse,
  productListResponseSchema,
} from "../schemas/product.schema";

export class ProductApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  // Raw response, so tests can also check status codes and invalid queries
  async getProducts(query: GetProductsQuery): Promise<APIResponse> {
    return await this.request.get(`${this.baseUrl}/api/products`, {
      params: query as Record<string, string | number | boolean>,
    });
  }

  async listProducts(query: GetProductsQuery): Promise<ProductListResponse> {
    const response = await this.getProducts(query);

    if (!response.ok()) {
      throw new Error(`Get products failed. Status: ${response.status()}`);
    }

    return productListResponseSchema.parse(await response.json());
  }

  // Accepts either the product UUID or its slug
  async getProduct(idOrSlug: string): Promise<ProductDetail> {
    const response = await this.request.get(
      `${this.baseUrl}/api/products/${idOrSlug}`,
    );

    if (!response.ok()) {
      throw new Error(`Get product failed. Status: ${response.status()}`);
    }

    return productDetailResponseSchema.parse(await response.json()).product;
  }

  async getCategories(): Promise<Category[]> {
    const response = await this.request.get(
      `${this.baseUrl}/api/products/categories`,
    );

    if (!response.ok()) {
      throw new Error(`Get categories failed. Status: ${response.status()}`);
    }

    return categoriesResponseSchema.parse(await response.json()).categories;
  }
}
