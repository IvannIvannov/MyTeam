import { parsePaymentAmount } from "./paymentAmount";

// Match online checkout: a positive personal fee overrides the club fee.
// The existing model uses zero when no personal fee has been configured.
export function resolveManualPaymentAmount(personalAmount: unknown, clubAmount: unknown): string | null {
  const personal = parsePaymentAmount(personalAmount);
  if (personal !== null && Number(personal) > 0) return personal;
  return parsePaymentAmount(clubAmount);
}
