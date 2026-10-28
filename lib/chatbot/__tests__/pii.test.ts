import { describe, expect, it } from "vitest";
import { prepareExternalText, redactPII } from "../pii";

describe("redactPII", () => {
  it("redacts a dashed Malaysian IC", () => {
    const result = redactPII("my IC is 990101-14-5678, when's my withdrawal");
    expect(result.clean).toBe("my IC is [IC], when's my withdrawal");
    expect(result.found).toBe(true);
  });

  it("redacts a bare 12-digit IC", () => {
    const result = redactPII("IC: 990101145678");
    expect(result.clean).toBe("IC: [IC]");
    expect(result.found).toBe(true);
  });

  it("redacts a Malaysian mobile number", () => {
    expect(redactPII("call me at 012-3456789").clean).toBe("call me at [PHONE]");
    expect(redactPII("call me at +60123456789").clean).toBe("call me at [PHONE]");
  });

  it("redacts an email address", () => {
    const result = redactPII("reach me at alice@example.com please");
    expect(result.clean).toBe("reach me at [EMAIL] please");
    expect(result.found).toBe(true);
  });

  it("redacts a credit-card-like digit run", () => {
    const result = redactPII("card number 4111111111111111 expired");
    expect(result.clean).toBe("card number [CARD] expired");
    expect(result.found).toBe(true);
  });

  it("redacts a passport number", () => {
    const result = redactPII("passport A12345678 on file");
    expect(result.clean).toBe("passport [PASSPORT] on file");
    expect(result.found).toBe(true);
  });

  it("redacts multiple PII items in one message", () => {
    const result = redactPII("IC 990101-14-5678, email alice@example.com, phone 012-3456789");
    expect(result.clean).toBe("IC [IC], email [EMAIL], phone [PHONE]");
    expect(result.found).toBe(true);
  });

  it("leaves clean text untouched and reports found:false", () => {
    const result = redactPII("how do I withdraw my money");
    expect(result.clean).toBe("how do I withdraw my money");
    expect(result.found).toBe(false);
  });

  it("is reusable across calls (regex lastIndex does not leak state)", () => {
    redactPII("IC 990101-14-5678");
    const second = redactPII("how do I book a tour");
    expect(second.clean).toBe("how do I book a tour");
    expect(second.found).toBe(false);
  });

  it("blocks explicit Chinese identity/address details and address-like postal blocks", () => {
    expect(prepareExternalText("我的地址是槟城乔治市12号")).toEqual({ allowed: false });
    expect(prepareExternalText("我住在槟城乔治市12号")).toEqual({ allowed: false });
    expect(prepareExternalText("我叫张三")).toEqual({ allowed: false });
    expect(prepareExternalText("我的名字是张三")).toEqual({ allowed: false });
    expect(prepareExternalText("我叫John")).toEqual({ allowed: false });
    expect(prepareExternalText("我的名字是John Smith")).toEqual({ allowed: false });
    expect(prepareExternalText("身份证990101-14-5678")).toEqual({ allowed: false });
    expect(prepareExternalText("12 George Town, Penang 10250")).toEqual({ allowed: false });
  });

  it("allows ordinary wallet review language while blocking personal bank details", () => {
    expect(prepareExternalText("The payout bank information does not match the review record.").allowed).toBe(true);
    expect(prepareExternalText("My bank account is 123456789012.")).toEqual({ allowed: false });
  });
});
