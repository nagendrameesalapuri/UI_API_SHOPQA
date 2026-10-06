import { APIRequestContext } from "@playwright/test";
import { Address } from "../models/auth.models";
import { SavedAddress } from "../models/address.models";
import {
  addressesResponseSchema,
  addressResponseSchema,
} from "../schemas/address.schema";

export class AddressApi {
  private readonly baseUrl: string;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.API_BASE_URL!;
    this.request = request;
  }

  async getAddresses(accessToken: string): Promise<SavedAddress[]> {
    const response = await this.request.get(
      `${this.baseUrl}/api/users/addresses`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok()) {
      throw new Error(`Get addresses failed. Status: ${response.status()}`);
    }

    return addressesResponseSchema.parse(await response.json()).addresses;
  }

  async addAddress(
    accessToken: string,
    address: Address,
    isDefault: boolean,
  ): Promise<SavedAddress> {
    const response = await this.request.post(
      `${this.baseUrl}/api/users/addresses`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { ...address, isDefault },
      },
    );

    if (!response.ok()) {
      throw new Error(`Add address failed. Status: ${response.status()}`);
    }

    return addressResponseSchema.parse(await response.json()).address;
  }
}
