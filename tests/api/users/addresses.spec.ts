import { test, expect } from "../../../fixtures/api.fixture";
import { addressResponseSchema } from "../../../api/schemas/address.schema";
import { expectError, expectStatus } from "../../../utils/api-assertions";
import { buildAddress } from "../../../test-data/users";
import { UNKNOWN_ID } from "../../../test-data/api";

test.describe("@API Users - addresses", () => {
  test("Add an address and read it back", async ({ api, addressApi, accessToken }) => {
    const address = buildAddress({ label: "Home" });
    const { address: saved } = addressResponseSchema.parse(
      await expectStatus(
        await api.path("users/addresses").auth(accessToken).body({ ...address, isDefault: true }).postRequest(),
        201,
      ),
    );
    expect(saved).toMatchObject({
      label: address.label,
      full_name: address.fullName,
      line1: address.line1,
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
      is_default: true,
    });

    expect(await addressApi.getAddresses(accessToken)).toEqual([saved]);
  });

  test("Only one address is default at a time", async ({
    api,
    addressApi,
    accessToken,
    savedAddresses: { home, work },
  }) => {
    const defaults = async () =>
      (await addressApi.getAddresses(accessToken)).filter(({ is_default }) => is_default).map(({ id }) => id);
    expect(await defaults()).toEqual([home.id]);

    await expectStatus(await api.path(`users/addresses/${work.id}/default`).auth(accessToken).patchRequest(), 200);
    expect(await defaults()).toEqual([work.id]);

    // Adding a new default address takes the flag over again
    const third = await addressApi.addAddress(accessToken, buildAddress({ label: "Parents" }), true);
    expect(await defaults()).toEqual([third.id]);
  });

  test("Edit an address", async ({ api, addressApi, accessToken, savedAddresses: { work } }) => {
    const changes = buildAddress({ label: "Work", city: "Hubballi", postalCode: "580020" });
    const body = addressResponseSchema.parse(
      await expectStatus(await api.path(`users/addresses/${work.id}`).auth(accessToken).body(changes).putRequest(), 200),
    );
    expect(body.address).toMatchObject({ id: work.id, city: "Hubballi", postal_code: "580020" });

    const stored = (await addressApi.getAddresses(accessToken)).find(({ id }) => id === work.id);
    expect(stored?.city).toBe("Hubballi");
  });

  test("Delete an address", async ({ api, addressApi, accessToken, savedAddresses: { home, work } }) => {
    await expectStatus(await api.path(`users/addresses/${work.id}`).auth(accessToken).deleteRequest(), 200);
    expect((await addressApi.getAddresses(accessToken)).map(({ id }) => id)).toEqual([home.id]);
  });

  test("Deleting an unknown address returns 404", async ({ api, accessToken }) => {
    const response = await api.path(`users/addresses/${UNKNOWN_ID}`).auth(accessToken).deleteRequest();
    // Today: 200 "Address deleted" whether or not anything was deleted
    await expectStatus(response, 404);
  });

  test("Another user cannot change or delete my address", async ({
    api,
    addressApi,
    accessToken,
    secondUser,
    savedAddresses: { home },
  }) => {
    await expectStatus(
      await api.path(`users/addresses/${home.id}`).auth(secondUser.accessToken).body(buildAddress()).putRequest(),
      404,
    );
    await expectStatus(
      await api.path(`users/addresses/${home.id}/default`).auth(secondUser.accessToken).patchRequest(),
      404,
    );
    const deleteAttempt = await api.path(`users/addresses/${home.id}`).auth(secondUser.accessToken).deleteRequest();

    // The address survives untouched (today the delete still answers 200)
    const mine = await addressApi.getAddresses(accessToken);
    expect(mine.find(({ id }) => id === home.id)).toEqual(home);
    expect(deleteAttempt.status(), "delete of someone else's address should be 404").toBe(404);
  });

  test("Invalid postal code is rejected", async ({ api, accessToken }) => {
    const response = await api
      .path("users/addresses")
      .auth(accessToken)
      .body({ ...buildAddress({ postalCode: "12" }), isDefault: false })
      .postRequest();
    // Today: 201, the address is saved with postal code "12"
    await expectStatus(response, 400);
  });

  test("Missing required fields are rejected with 400", async ({ api, accessToken }) => {
    const response = await api.path("users/addresses").auth(accessToken).body({ label: "Empty" }).postRequest();
    // Today: 500 with a raw database not-null error
    await expectError(response, 400);
  });
});
