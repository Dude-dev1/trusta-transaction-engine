import { describe, expect, it } from "vitest";

import { hashTransferRequest } from "../../src/utils/request-hash.js";

const base = {
  userId: "11111111-1111-1111-1111-111111111111",

  sourceAccountId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",

  destinationAccountId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",

  currency: "USD",
};

describe("hashTransferRequest", () => {
  it("produces the same hash for the same semantic request", () => {
    const first = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
    });

    const second = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
    });

    expect(first).toBe(second);
  });

  it("produces a stable hash for a large bigint amount", () => {
    const first = hashTransferRequest({
      ...base,
      amountMinor: 9007199254740993n,
    });

    const second = hashTransferRequest({
      ...base,
      amountMinor: 9007199254740993n,
    });

    expect(first).toBe(second);
  });

  it("changes when the amount changes", () => {
    const original = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
    });

    const changed = hashTransferRequest({
      ...base,
      amountMinor: 10001n,
    });

    expect(changed).not.toBe(original);
  });

  it("changes when the source account changes", () => {
    const original = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
    });

    const changed = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
      sourceAccountId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });

    expect(changed).not.toBe(original);
  });

  it("changes when the destination account changes", () => {
    const original = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
    });

    const changed = hashTransferRequest({
      ...base,
      amountMinor: 10000n,
      destinationAccountId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });

    expect(changed).not.toBe(original);
  });
});
