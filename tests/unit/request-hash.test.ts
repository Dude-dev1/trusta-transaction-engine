import { describe, expect, it } from "vitest";
import { hashTransferRequest } from "../../src/utils/request-hash.js";

describe("hashTransferRequest", () => {
  it("produces the same hash for the same semantic request", () => {
    const first = hashTransferRequest({
      userId: "11111111-1111-1111-1111-111111111111",
      sourceAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      destinationAccountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      amountMinor: 10000,
      currency: "USD",
    });

    const second = hashTransferRequest({
      userId: "11111111-1111-1111-1111-111111111111",
      sourceAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      destinationAccountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      amountMinor: 10000,
      currency: "USD",
    });

    expect(first).toBe(second);
  });

  it("changes when the request changes", () => {
    const original = hashTransferRequest({
      userId: "11111111-1111-1111-1111-111111111111",
      sourceAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      destinationAccountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      amountMinor: 10000,
      currency: "USD",
    });

    const changed = hashTransferRequest({
      userId: "11111111-1111-1111-1111-111111111111",
      sourceAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      destinationAccountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      amountMinor: 12000,
      currency: "USD",
    });

    expect(changed).not.toBe(original);
  });
});
