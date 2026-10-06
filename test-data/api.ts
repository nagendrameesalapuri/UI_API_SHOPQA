// Shared constants for the API suite

// A well-formed UUID that matches no record
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

// Payment simulation cards from the API docs
export const TEST_CARDS = {
  success: "4111111111111111",
  insufficientFunds: "4000000000000002",
  expired: "4000000000000069",
  doNotHonor: "4000000000009995",
};

export function cardPayment(cardNumber: string) {
  return {
    paymentMethod: "credit_card",
    paymentData: { cardNumber, expiry: "12/30", cvv: "123", name: "QA AUTOMATION" },
  };
}

// Pricing rules as implemented by the API
export const TAX_RATE = 0.18;
export const FREE_SHIPPING_THRESHOLD = 500;
export const STANDARD_SHIPPING = 49;

export const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
