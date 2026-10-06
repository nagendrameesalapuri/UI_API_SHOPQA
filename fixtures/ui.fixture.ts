import { Page } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { EmailVerificationPage } from "../pages/EmailVerificationPage";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../pages/ResetPasswordPage";
import { ProductListPage } from "../pages/ProductListPage";
import { ProductDetailPage } from "../pages/ProductDetailPage";
import { CartPage } from "../pages/CartPage";
import { CheckoutPage } from "../pages/CheckoutPage";
import { AddressBookPage } from "../pages/AddressBookPage";
import { OrderDetailPage } from "../pages/OrderDetailPage";
import { OrdersPage } from "../pages/OrdersPage";
import { ProfilePage } from "../pages/ProfilePage";
import { WishlistPage } from "../pages/WishlistPage";
import { AdminDashboardPage } from "../pages/admin/AdminDashboardPage";
import { AdminProductsPage } from "../pages/admin/AdminProductsPage";
import { AdminOrdersPage } from "../pages/admin/AdminOrdersPage";
import { AdminUsersPage } from "../pages/admin/AdminUsersPage";
import { AdminCouponsPage } from "../pages/admin/AdminCouponsPage";
import { ADMIN_EMAIL, ADMIN_PASSWORD, test as dataTest } from "./data.fixture";

// Page objects on top of the shared API clients and test data (data.fixture.ts)
type UIFixtures = {
  loginPage: LoginPage;
  registerPage: RegisterPage;
  emailVerificationPage: EmailVerificationPage;
  forgotPasswordPage: ForgotPasswordPage;
  resetPasswordPage: ResetPasswordPage;
  productListPage: ProductListPage;
  productDetailPage: ProductDetailPage;
  cartPage: CartPage;
  checkoutPage: CheckoutPage;
  addressBookPage: AddressBookPage;
  orderDetailPage: OrderDetailPage;
  ordersPage: OrdersPage;
  profilePage: ProfilePage;
  wishlistPage: WishlistPage;
  adminDashboardPage: AdminDashboardPage;
  adminPage: Page;
  adminProductsPage: AdminProductsPage;
  adminOrdersPage: AdminOrdersPage;
  adminUsersPage: AdminUsersPage;
  adminCouponsPage: AdminCouponsPage;
};

export const test = dataTest.extend<UIFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },

  emailVerificationPage: async ({ page }, use) => {
    await use(new EmailVerificationPage(page));
  },

  forgotPasswordPage: async ({ page }, use) => {
    await use(new ForgotPasswordPage(page));
  },

  resetPasswordPage: async ({ page }, use) => {
    await use(new ResetPasswordPage(page));
  },

  productListPage: async ({ page }, use) => {
    await use(new ProductListPage(page));
  },

  productDetailPage: async ({ page }, use) => {
    await use(new ProductDetailPage(page));
  },

  cartPage: async ({ page }, use) => {
    await use(new CartPage(page));
  },

  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },

  addressBookPage: async ({ page }, use) => {
    await use(new AddressBookPage(page));
  },

  orderDetailPage: async ({ page }, use) => {
    await use(new OrderDetailPage(page));
  },

  ordersPage: async ({ page }, use) => {
    await use(new OrdersPage(page));
  },

  profilePage: async ({ page }, use) => {
    await use(new ProfilePage(page));
  },

  wishlistPage: async ({ page }, use) => {
    await use(new WishlistPage(page));
  },

  // On the customer's page: used to check what a non-admin sees at /admin
  adminDashboardPage: async ({ page }, use) => {
    await use(new AdminDashboardPage(page));
  },

  // A second browser context logged in as admin, so a test can drive the admin
  // panel and the customer storefront side by side
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: process.env.UI_BASE_URL,
      viewport: null,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(ADMIN_EMAIL, ADMIN_PASSWORD);
    // Admins land on the admin panel, which has no storefront user menu
    await new AdminDashboardPage(page).verifyAdminPanelShown();

    await use(page);
    await context.close();
  },

  adminProductsPage: async ({ adminPage }, use) => {
    await use(new AdminProductsPage(adminPage));
  },

  adminOrdersPage: async ({ adminPage }, use) => {
    await use(new AdminOrdersPage(adminPage));
  },

  adminUsersPage: async ({ adminPage }, use) => {
    await use(new AdminUsersPage(adminPage));
  },

  adminCouponsPage: async ({ adminPage }, use) => {
    await use(new AdminCouponsPage(adminPage));
  },
});

export { expect } from "@playwright/test";
