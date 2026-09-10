import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createGaInitScript,
  parseGaMeasurementId,
  redactGaLocation,
  sendGaEvent,
  shouldLoadGoogleAnalytics,
} from "./ga";

const originalMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

afterEach(() => {
  if (originalMeasurementId === undefined) {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  } else {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalMeasurementId;
  }
  delete (globalThis as { window?: unknown }).window;
});

describe("parseGaMeasurementId", () => {
  it("accepts a GA4 measurement ID", () => {
    assert.equal(parseGaMeasurementId("G-ABC12DEF34"), "G-ABC12DEF34");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(parseGaMeasurementId("  G-ZXCVBNM90  "), "G-ZXCVBNM90");
  });

  it("rejects missing, legacy, and injectable values", () => {
    assert.equal(parseGaMeasurementId(undefined), null);
    assert.equal(parseGaMeasurementId(""), null);
    assert.equal(parseGaMeasurementId("UA-123456-1"), null);
    assert.equal(parseGaMeasurementId("GTM-ABCDE"), null);
    assert.equal(parseGaMeasurementId("g-abc12def34"), null);
    assert.equal(parseGaMeasurementId("G-ABC12DEF34';alert(1)//"), null);
    assert.equal(parseGaMeasurementId("G-ABC12DEF34\nG-OTHER"), null);
  });
});

describe("createGaInitScript", () => {
  it("configures the validated measurement ID without ads signals", () => {
    const script = createGaInitScript("G-ABC12DEF34", false);

    assert.match(script, /"G-ABC12DEF34"/);
    assert.match(script, /ad_storage:\s*"denied"/);
    assert.match(script, /analytics_storage:\s*"granted"/);
    assert.match(script, /allow_google_signals:\s*false/);
    assert.match(script, /allow_ad_personalization_signals:\s*false/);
    assert.match(script, /send_page_view:\s*false/);
    assert.match(script, /cookie_expires:\s*0/);
    assert.doesNotMatch(script, /debug_mode/);
    assert.doesNotMatch(script, /user_id/);
    assert.doesNotMatch(script, /session_id/);
  });

  it("rejects an invalid measurement ID instead of interpolating it", () => {
    assert.throws(() => createGaInitScript("G-ABC12DEF34';alert(1)//", false), /invalid GA measurement ID/);
  });

  it("enables debug mode only when requested", () => {
    const script = createGaInitScript("G-ABC12DEF34", true);
    assert.match(script, /debug_mode:\s*true/);
  });
});

describe("sendGaEvent", () => {
  it("does not queue events when no measurement ID is configured", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const dataLayer: unknown[] = [];
    (globalThis as unknown as { window: { dataLayer: unknown[]; gtag?: unknown } }).window = {
      dataLayer,
    };

    sendGaEvent("join_started", { party_size: 1 });

    assert.deepEqual(dataLayer, []);
  });

  it("sends allowlisted event params through gtag without identifiers", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC12DEF34";
    const pushed: unknown[] = [];
    const gtag = (...args: unknown[]) => {
      pushed.push([...args]);
    };
    (globalThis as unknown as {
      window: {
        dataLayer: unknown[];
        gtag: typeof gtag;
        location: { href: string; pathname: string };
      };
    }).window = {
      dataLayer: [],
      gtag,
      location: {
        href: "https://kkinggitara.example/waiting/11111111-1111-4111-8111-111111111111",
        pathname: "/waiting/11111111-1111-4111-8111-111111111111",
      },
    };

    sendGaEvent("matching_started", {
      drop_zone_id: "zone_a",
      party_size: 2,
      preference: "fast",
      session_id: "secret-session",
      user_id: "secret-user",
    } as Record<string, string | number>);

    assert.deepEqual(pushed, [
      [
        "event",
        "matching_started",
        {
          drop_zone_id: "zone_a",
          party_size: 2,
          preference: "fast",
          page_location: "https://kkinggitara.example/waiting/_",
        },
      ],
    ]);
  });

  it("queues Arguments-like commands when gtag is not installed yet", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC12DEF34";
    const dataLayer: unknown[] = [];
    (globalThis as unknown as { window: { dataLayer: unknown[]; location: { href: string; pathname: string } } }).window = {
      dataLayer,
      location: { href: "https://kkinggitara.example/join", pathname: "/join" },
    };

    sendGaEvent("join_started", { party_size: 1 });

    const queued = dataLayer[0] as ArrayLike<unknown> & { callee?: unknown };
    assert.equal(Array.isArray(queued), false);
    assert.equal(queued[0], "event");
    assert.equal(queued[1], "join_started");
    assert.deepEqual(queued[2], {
      party_size: 1,
      page_location: "https://kkinggitara.example/join",
    });
  });
});

describe("redactGaLocation", () => {
  it("strips query, hash, and ride identifiers", () => {
    assert.equal(
      redactGaLocation("https://kkinggitara.example/waiting/11111111-1111-4111-8111-111111111111?x=1#y"),
      "https://kkinggitara.example/waiting/_",
    );
    assert.equal(
      redactGaLocation("https://kkinggitara.example/team/22222222-2222-4222-8222-222222222222"),
      "https://kkinggitara.example/team/_",
    );
    assert.equal(
      redactGaLocation("https://kkinggitara.example/join"),
      "https://kkinggitara.example/join",
    );
  });
});

describe("shouldLoadGoogleAnalytics", () => {
  it("loads only for public routes when a measurement ID is set", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC12DEF34";
    assert.equal(shouldLoadGoogleAnalytics("/join"), true);
    assert.equal(shouldLoadGoogleAnalytics("/admin"), false);
    assert.equal(shouldLoadGoogleAnalytics("/admin/dashboard"), false);
  });
});
