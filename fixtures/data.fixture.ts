import { test as base } from "@playwright/test";
import { QaApi } from "../api/clients/QaApi";
import { AuthApi } from "../api/clients/AuthApi";
import { ProductApi } from "../api/clients/ProductApi";
import { ReviewApi } from "../api/clients/ReviewApi";
import { CartApi } from "../api/clients/CartApi";
import { AddressApi } from "../api/clients/AddressApi";
import { OrderApi } from "../api/clients/OrderApi";
import { AdminApi } from "../api/clients/AdminApi";
import { WishlistApi } from "../api/clients/WishlistApi";
import { UserApi } from "../api/clients/UserApi";
import { Order } from "../api/models/order.models";
import { SavedAddress } from "../api/models/address.models";
import {
  RegisterUserRequest,
  RegisterUserResponse,
} from "../api/models/auth.models";
import { buildAddress, buildNewUser } from "../test-data/users";
import { RequestHandler } from "../utils/request-handler";

// API clients and test-data fixtures, shared by the UI, E2E and API suites.
// Every user created here is brand new, so tests never share carts or orders.
export type DataFixtures = {
  api: RequestHandler;
  qaApi: QaApi;
  authApi: AuthApi;
  productApi: ProductApi;
  reviewApi: ReviewApi;
  cartApi: CartApi;
  addressApi: AddressApi;
  orderApi: OrderApi;
  adminApi: AdminApi;
  wishlistApi: WishlistApi;
  userApi: UserApi;
  adminAccessToken: string;
  verifiedUser: RegisterUserRequest;
  pendingUser: PendingUser;
  accessToken: string;
  secondUser: SecondUser;
  outOfStockProduct: OutOfStockProduct;
  reviewsToDelete: string[];
  lowStockProduct: LowStockProduct;
  userWithCart: UserWithCart;
  savedAddresses: SavedAddresses;
  checkoutCart: string;
  orderProductSlug: string;
  placedOrder: PlacedOrder;
  productsToDeactivate: string[];
  couponsToCleanUp: string[];
};

type PlacedOrder = { order: Order; productId: string; productName: string };
type PendingUser = RegisterUserRequest & { verificationToken: string };
type SecondUser = RegisterUserRequest & { accessToken: string };
type OutOfStockProduct = { id: string; name: string };
type LowStockProduct = { id: string; slug: string; name: string; stock: number };
type UserWithCart = { accessToken: string; productName: string };
type SavedAddresses = { home: SavedAddress; work: SavedAddress };

// Seeded products, kept separate so parallel workers do not touch the same one
const LOW_STOCK_PRODUCT_SLUG = "clean-code";
const CART_PRODUCT_SLUG = "the-pragmatic-programmer";
const CART_PRODUCT_QUANTITY = 4;
const LOW_STOCK = 3;
const CHECKOUT_PRODUCT_SLUG = "atomic-habits";
const OUT_OF_STOCK_PRODUCT_SLUG = "chess-set-wooden";

export const ADMIN_EMAIL = process.env.UI_TEST_ADMIN_EMAIL!;
export const ADMIN_PASSWORD = process.env.UI_TEST_ADMIN_PASSWORD!;

async function registerVerifiedUser(authApi: AuthApi) {
  const user = buildNewUser();
  const response: RegisterUserResponse = await authApi.registerNewUser(user);
  await authApi.verifyEmail(response.verificationToken);
  return user;
}

export const test = base.extend<DataFixtures>({
  // Fluent builder for raw requests (status codes, error bodies, bad input)
  api: async ({ request }, use) => {
    await use(new RequestHandler(request, `${process.env.API_BASE_URL}/api/`));
  },

  qaApi: async ({ request }, use) => {
    await use(new QaApi(request));
  },

  authApi: async ({ request }, use) => {
    await use(new AuthApi(request));
  },

  productApi: async ({ request }, use) => {
    await use(new ProductApi(request));
  },

  reviewApi: async ({ request }, use) => {
    await use(new ReviewApi(request));
  },

  cartApi: async ({ request }, use) => {
    await use(new CartApi(request));
  },

  addressApi: async ({ request }, use) => {
    await use(new AddressApi(request));
  },

  orderApi: async ({ request }, use) => {
    await use(new OrderApi(request));
  },

  adminApi: async ({ request }, use) => {
    await use(new AdminApi(request));
  },

  wishlistApi: async ({ request }, use) => {
    await use(new WishlistApi(request));
  },

  userApi: async ({ request }, use) => {
    await use(new UserApi(request));
  },

  verifiedUser: async ({ authApi }, use) => {
    await use(await registerVerifiedUser(authApi));
  },

  // Registered but not yet verified
  pendingUser: async ({ authApi }, use) => {
    const user = buildNewUser();
    const response: RegisterUserResponse = await authApi.registerNewUser(user);
    await use({ ...user, verificationToken: response.verificationToken });
  },

  adminAccessToken: async ({ authApi }, use) => {
    const { accessToken } = await authApi.login({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    await use(accessToken);
  },

  // API access token for verifiedUser
  accessToken: async ({ verifiedUser, authApi }, use) => {
    const { accessToken } = await authApi.login({
      email: verifiedUser.email,
      password: verifiedUser.password,
    });
    await use(accessToken);
  },

  // A second, unrelated customer: for checking one user cannot touch another's data
  secondUser: async ({ authApi }, use) => {
    const user = await registerVerifiedUser(authApi);
    const { accessToken } = await authApi.login({
      email: user.email,
      password: user.password,
    });
    await use({ ...user, accessToken });
  },

  // verifiedUser with a default "Home" address and a non-default "Work" address
  savedAddresses: async ({ accessToken, addressApi }, use) => {
    const home = await addressApi.addAddress(
      accessToken,
      buildAddress({ label: "Home" }),
      true,
    );
    const work = await addressApi.addAddress(
      accessToken,
      buildAddress({ label: "Work", city: "Mysuru", postalCode: "570001" }),
      false,
    );
    await use({ home, work });
  },

  // Puts one checkout product in verifiedUser's cart; yields the product name
  checkoutCart: async ({ accessToken, productApi, cartApi }, use) => {
    const product = await productApi.getProduct(CHECKOUT_PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, 1);
    await use(product.name);
  },

  // Product the placedOrder fixture buys; override per file with test.use()
  orderProductSlug: [CHECKOUT_PRODUCT_SLUG, { option: true }],

  // A cash-on-delivery order for one unit of orderProductSlug, placed via the API
  placedOrder: async (
    { accessToken, orderProductSlug, productApi, cartApi, orderApi },
    use,
  ) => {
    const product = await productApi.getProduct(orderProductSlug);
    await cartApi.addItem(accessToken, product.id, 1);
    const order = await orderApi.placeCodOrder(accessToken, buildAddress());
    await use({ order, productId: product.id, productName: product.name });
  },

  // Products pushed here (by id) are deactivated after the test
  productsToDeactivate: async ({ adminApi, adminAccessToken }, use) => {
    const productIds: string[] = [];
    await use(productIds);
    for (const productId of productIds) {
      await adminApi.deactivateProduct(adminAccessToken, productId);
    }
  },

  // Coupons pushed here (by code) are deleted after the test, or disabled when in use
  couponsToCleanUp: async ({ adminApi, adminAccessToken }, use) => {
    const codes: string[] = [];
    await use(codes);
    for (const code of codes) {
      await adminApi.deleteOrDisableCoupon(adminAccessToken, code);
    }
  },

  // Drops a product to LOW_STOCK units for the test, then restores its stock
  lowStockProduct: async ({ productApi, qaApi }, use) => {
    const product = await productApi.getProduct(LOW_STOCK_PRODUCT_SLUG);

    await qaApi.setProductStock(product.id, LOW_STOCK);
    try {
      await use({
        id: product.id,
        slug: product.slug,
        name: product.name,
        stock: LOW_STOCK,
      });
    } finally {
      await qaApi.setProductStock(product.id, product.stock);
    }
  },

  // verifiedUser whose cart already holds items worth more than FLAT500 minimum (2000)
  userWithCart: async ({ accessToken, productApi, cartApi }, use) => {
    const product = await productApi.getProduct(CART_PRODUCT_SLUG);
    await cartApi.addItem(accessToken, product.id, CART_PRODUCT_QUANTITY);

    await use({ accessToken, productName: product.name });
  },

  // Review IDs pushed here are deleted after the test, as the verifiedUser who wrote them
  reviewsToDelete: async ({ verifiedUser, authApi, reviewApi }, use) => {
    const reviewIds: string[] = [];
    await use(reviewIds);

    if (reviewIds.length === 0) return;
    const { accessToken } = await authApi.login({
      email: verifiedUser.email,
      password: verifiedUser.password,
    });
    for (const reviewId of reviewIds) {
      await reviewApi.deleteReview(reviewId, accessToken);
    }
  },

  // Takes an in-stock product out of stock for the test, then restores its stock
  outOfStockProduct: async ({ productApi, qaApi }, use) => {
    // A fixed seeded product: "newest" could be one another test just created
    const product = await productApi.getProduct(OUT_OF_STOCK_PRODUCT_SLUG);

    await qaApi.setProductsOutOfStock([product.id]);
    try {
      await use({ id: product.id, name: product.name });
    } finally {
      await qaApi.setProductStock(product.id, product.stock);
    }
  },
});

export { expect } from "@playwright/test";
