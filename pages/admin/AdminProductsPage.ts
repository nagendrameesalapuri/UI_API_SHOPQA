import { expect, Locator, Page } from "@playwright/test";

const PRODUCT_RESPONSE_TIMEOUT = 30000;

export interface ProductFormData {
  name: string;
  price: number;
  stock: number;
  category: string;
  brand: string;
  description: string;
  image?: { name: string; mimeType: string; buffer: Buffer };
}

export class AdminProductsPage {
  private page: Page;
  private addProductButton: Locator;
  private searchInput: Locator;
  private productRows: Locator;
  private productModal: Locator;
  private imageInput: Locator;
  private imageDropzone: Locator;
  private nameInput: Locator;
  private priceInput: Locator;
  private stockInput: Locator;
  private categorySelect: Locator;
  private brandInput: Locator;
  private descriptionInput: Locator;
  private saveProductButton: Locator;
  private toastMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addProductButton = page.getByTestId("btn-add-product");
    this.searchInput = page.getByTestId("admin-product-search");
    this.productRows = page.getByTestId("admin-product-row");
    this.productModal = page.getByTestId("product-form-modal");
    this.imageInput = page.getByTestId("image-file-input");
    this.imageDropzone = page.getByTestId("image-dropzone");
    this.nameInput = page.getByTestId("product-name-input");
    this.priceInput = page.getByTestId("product-price-input");
    this.stockInput = page.getByTestId("product-stock-input");
    this.categorySelect = page.getByTestId("product-category-select");
    this.brandInput = page.getByTestId("product-brand-input");
    this.descriptionInput = page.getByTestId("product-desc-input");
    this.saveProductButton = page.getByTestId("btn-save-product");
    this.toastMessage = page.locator(".Toastify__toast-body[role='alert']");
  }

  private waitForProductResponse(method: string) {
    return this.page.waitForResponse(
      (response) =>
        /\/api\/products(\/[^/]+)?$/.test(new URL(response.url()).pathname) &&
        response.request().method() === method,
      { timeout: PRODUCT_RESPONSE_TIMEOUT },
    );
  }

  async navigateToProductsPage() {
    await this.page.goto("/admin/products");
    await expect(this.productRows.first()).toBeVisible({
      timeout: PRODUCT_RESPONSE_TIMEOUT,
    });
  }

  productRow(name: string): Locator {
    return this.productRows.filter({
      has: this.page.getByTestId("admin-product-name").getByText(name, {
        exact: true,
      }),
    });
  }

  async searchFor(name: string) {
    await this.searchInput.fill(name);
    // The filtered list comes back from the API; slow under parallel load
    await expect(this.productRows).toHaveCount(1, {
      timeout: PRODUCT_RESPONSE_TIMEOUT,
    });
    await expect(this.productRow(name)).toHaveCount(1);
  }

  // Returns the product the API created
  async createProduct(product: ProductFormData) {
    await this.addProductButton.click();
    await expect(this.productModal).toBeVisible();
    if (product.image) {
      await this.imageInput.setInputFiles(product.image);
      await expect(this.imageDropzone).toContainText("1 image(s) selected");
    }
    await this.nameInput.fill(product.name);
    await this.priceInput.fill(String(product.price));
    await this.stockInput.fill(String(product.stock));
    await this.categorySelect.selectOption({ label: product.category });
    await this.brandInput.fill(product.brand);
    await this.descriptionInput.fill(product.description);

    const created = this.waitForProductResponse("POST");
    await this.saveProductButton.click();
    const response = await created;
    expect(response.status()).toBe(201);
    await this.verifyToast("Product created");
    await expect(this.productModal).toBeHidden();
    return (await response.json()).product;
  }

  async editPrice(name: string, price: number) {
    await this.productRow(name).getByTestId("btn-edit-product").click();
    await expect(this.productModal).toBeVisible();
    await expect(this.nameInput).toHaveValue(name);
    await this.priceInput.fill(String(price));

    const updated = this.waitForProductResponse("PUT");
    await this.saveProductButton.click();
    expect((await updated).ok()).toBeTruthy();
    await this.verifyToast("Product updated");
    await expect(this.productModal).toBeHidden();
  }

  async deleteProduct(name: string) {
    // Confirmed through a native dialog: Deactivate "<name>"?
    this.page.once("dialog", (dialog) => dialog.accept());
    const deleted = this.waitForProductResponse("DELETE");
    await this.productRow(name).getByTestId("btn-delete-product").click();
    expect((await deleted).ok()).toBeTruthy();
    await this.verifyToast("Product deactivated");
  }

  async verifyProductRow(
    name: string,
    details: { category: string; price: string; stock: number },
  ) {
    const row = this.productRow(name);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("admin-product-category")).toHaveText(details.category);
    await expect(row.getByTestId("admin-product-price")).toHaveText(details.price);
    await expect(row.getByTestId("admin-product-stock")).toHaveText(String(details.stock));
    await expect(row.getByTestId("admin-product-status")).toHaveText("Active");
  }

  async verifyProductNotListed(name: string) {
    await expect(this.productRow(name)).toHaveCount(0);
  }

  async verifyToast(message: string) {
    await expect(this.toastMessage.filter({ hasText: message }).first()).toBeVisible();
  }
}
