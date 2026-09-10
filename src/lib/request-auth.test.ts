import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasBearerSecret,
  isSameOriginHeaders,
  isSameOriginRequest,
  resolveAdminEmailAllowlist,
} from "./request-auth";

describe("resolveAdminEmailAllowlist", () => {
  it("uses ADMIN_EMAILS in production", () => {
    const emails = resolveAdminEmailAllowlist(
      "Ops@example.com, other@example.com",
      "dev@example.com",
      "production",
    );
    assert.deepEqual([...emails], ["ops@example.com", "other@example.com"]);
  });

  it("fails closed in production when ADMIN_EMAILS is empty", () => {
    const emails = resolveAdminEmailAllowlist(undefined, "dev@example.com", "production");
    assert.equal(emails.size, 0);
  });

  it("uses DEV_ADMIN_EMAILS only outside production when ADMIN_EMAILS is unset", () => {
    const emails = resolveAdminEmailAllowlist(undefined, "Dev@example.com", "development");
    assert.deepEqual([...emails], ["dev@example.com"]);
  });
});

describe("hasBearerSecret", () => {
  it("rejects missing secrets and headers", () => {
    assert.equal(hasBearerSecret("Bearer secret", undefined), false);
    assert.equal(hasBearerSecret(null, "secret"), false);
    assert.equal(hasBearerSecret("Bearer secret", ""), false);
  });

  it("accepts an exact Bearer match", () => {
    assert.equal(hasBearerSecret("Bearer super-secret", "super-secret"), true);
  });

  it("rejects a different secret of the same length", () => {
    assert.equal(hasBearerSecret("Bearer super-secret", "super-sekret"), false);
  });
});

describe("isSameOriginHeaders", () => {
  it("accepts a same-origin browser POST", () => {
    assert.equal(
      isSameOriginHeaders("https://app.example", "app.example", "same-origin"),
      true,
    );
  });

  it("accepts 127.0.0.1 even when the request URL was rewritten to localhost", () => {
    assert.equal(
      isSameOriginHeaders("http://127.0.0.1:3000", "127.0.0.1:3000", "same-origin"),
      true,
    );
  });

  it("rejects a cross-site origin", () => {
    assert.equal(isSameOriginHeaders("https://evil.example", "app.example", null), false);
  });

  it("rejects a missing origin header", () => {
    assert.equal(isSameOriginHeaders(null, "app.example", "same-origin"), false);
  });

  it("rejects cross-site fetch metadata", () => {
    assert.equal(
      isSameOriginHeaders("https://app.example", "app.example", "cross-site"),
      false,
    );
  });
});

describe("isSameOriginRequest", () => {
  it("reads origin and host from the request", () => {
    const request = new Request("https://app.example/api/cron", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        host: "app.example",
        "sec-fetch-site": "same-origin",
      },
    });
    assert.equal(isSameOriginRequest(request), true);
  });
});
