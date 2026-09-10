import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContentSecurityPolicy } from "./content-security-policy";
import { GA4_CONNECT_SOURCES, GA4_IMG_SOURCES } from "./ga";

describe("buildContentSecurityPolicy", () => {
  it("allows GA4 collection while keeping nonce-based script-src", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "test-nonce",
      isDevelopment: false,
      supabaseUrl: "https://example.supabase.co",
      enableGoogleAnalytics: true,
    });

    assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/);
    assert.doesNotMatch(policy, /script-src[^;]*unsafe-eval/);

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const source of GA4_CONNECT_SOURCES) {
      assert.match(policy, new RegExp(`connect-src[^;]*${escapeRegExp(source)}`));
    }
    for (const source of GA4_IMG_SOURCES) {
      assert.match(policy, new RegExp(`img-src[^;]*${escapeRegExp(source)}`));
    }
    assert.match(policy, /connect-src[^;]*https:\/\/example\.supabase\.co/);
    assert.match(policy, /img-src[^;]*https:\/\/example\.supabase\.co/);
  });

  it("does not open script-src to Google hosts because strict-dynamic covers gtag.js", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "test-nonce",
      isDevelopment: true,
      enableGoogleAnalytics: true,
    });

    assert.match(policy, /script-src[^;]*'unsafe-eval'/);
    assert.doesNotMatch(policy, /script-src[^;]*googletagmanager/);
  });

  it("omits GA4 hosts until a measurement ID is configured", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "test-nonce",
      isDevelopment: false,
    });

    assert.doesNotMatch(policy, /google-analytics/);
    assert.doesNotMatch(policy, /googletagmanager/);
  });
});
