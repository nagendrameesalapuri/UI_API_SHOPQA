import { test, expect } from "../../../fixtures/ui.fixture";
import { buildAddress } from "../../../test-data/users";

test.describe("Address Management Tests", () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ loginPage, verifiedUser }) => {
    await loginPage.navigateToLoginPage();
    await loginPage.loginWith(verifiedUser.email, verifiedUser.password);
    await loginPage.verifyUserIsLoggedIn();
  });

  test("@Regression TC-048 First address defaults automatically", async ({
    addressBookPage,
  }) => {
    const address = buildAddress({ label: "Home" });

    await addressBookPage.navigateToAddressBook();
    await addressBookPage.verifyAddressCount(0);

    await addressBookPage.openAddAddressForm();
    await addressBookPage.verifyDefaultCheckbox(true);
    await addressBookPage.fillAddressForm(address);
    const saved = await addressBookPage.saveNewAddress();

    await addressBookPage.verifyAddressCount(1);
    await addressBookPage.verifyAddressCardShows(saved.id, address);
    await addressBookPage.verifyIsDefault(saved.id);
  });

  test("@Regression TC-049 Add a second, non-default address", async ({
    addressBookPage,
    addressApi,
    accessToken,
  }) => {
    const home = await addressApi.addAddress(
      accessToken,
      buildAddress({ label: "Home" }),
      true,
    );
    const work = buildAddress({ label: "Work", city: "Mysuru", postalCode: "570001" });

    await addressBookPage.navigateToAddressBook();
    await addressBookPage.openAddAddressForm();
    await addressBookPage.verifyDefaultCheckbox(false);
    await addressBookPage.fillAddressForm(work);
    const savedWork = await addressBookPage.saveNewAddress();

    await addressBookPage.verifyAddressCount(2);
    await addressBookPage.verifyAddressCardShows(savedWork.id, work);
    await addressBookPage.verifyIsDefault(home.id);
    await addressBookPage.verifyIsNotDefault(savedWork.id);
    await addressBookPage.verifyOnlyOneDefault();
  });

  test("@Regression TC-050 Edit an address", async ({
    addressBookPage,
    savedAddresses: { work },
  }) => {
    const changes = { city: "Hubballi", postalCode: "580020" };

    await addressBookPage.navigateToAddressBook();
    await addressBookPage.editAddress(work.id, changes);

    await addressBookPage.verifyAddressCardShows(work.id, {
      label: work.label,
      fullName: work.full_name,
      phone: work.phone,
      line1: work.line1,
      line2: work.line2 ?? "",
      city: changes.city,
      state: work.state,
      postalCode: changes.postalCode,
      country: work.country,
    });
  });

  test("@Regression TC-051 Set a different address as default", async ({
    addressBookPage,
    savedAddresses: { home, work },
  }) => {
    await addressBookPage.navigateToAddressBook();
    await addressBookPage.verifyIsDefault(home.id);

    await addressBookPage.setDefault(work.id);

    await addressBookPage.verifyIsDefault(work.id);
    await addressBookPage.verifyIsNotDefault(home.id);
    await addressBookPage.verifyOnlyOneDefault();
  });

  test("@Regression TC-052 Delete an address", async ({
    addressBookPage,
    checkoutPage,
    savedAddresses: { home, work },
    checkoutCart,
  }) => {
    await addressBookPage.navigateToAddressBook();
    await addressBookPage.deleteAddress(work.id);

    await addressBookPage.verifyAddressRemoved(work.id);
    await addressBookPage.verifyAddressCount(1);

    await test.step("Deleted address is not offered at checkout", async () => {
      await checkoutPage.navigateToCheckoutPage();
      await checkoutPage.verifySavedAddressNotOffered(work.id);
      await checkoutPage.verifySavedAddressesOffered([home.id]);
    });
  });

  test("@Regression TC-053 Add multiple addresses", async ({
    addressBookPage,
  }) => {
    const labels = ["Home", "Work", "Parents", "Gym", "Holiday Home"];
    const savedIds: string[] = [];

    await addressBookPage.navigateToAddressBook();
    for (const label of labels) {
      await test.step(`Add "${label}" address`, async () => {
        const address = buildAddress({ label });
        const saved = await addressBookPage.addAddress(address);
        savedIds.push(saved.id);
        await addressBookPage.verifyAddressCardShows(saved.id, address);
      });
    }

    await addressBookPage.verifyAddressCount(labels.length);
    for (const addressId of savedIds) {
      await addressBookPage.verifyCardActions(addressId);
    }

    await test.step("Each address is editable and deletable on its own", async () => {
      const [, , toEdit, toDelete] = savedIds;
      const edited = await addressBookPage.editAddress(toEdit, {
        city: "Mangaluru",
        postalCode: "575001",
      });
      expect(edited.city).toBe("Mangaluru");

      await addressBookPage.deleteAddress(toDelete);
      await addressBookPage.verifyAddressRemoved(toDelete);
      await addressBookPage.verifyAddressCount(labels.length - 1);
    });
  });
});
