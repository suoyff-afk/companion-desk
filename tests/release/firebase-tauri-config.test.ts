import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createFirebaseTauriOverlay,
  validateFirebaseBuildEnvironment,
} from "../../scripts/generate-firebase-tauri-config.mjs";

const baseConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
);

function environment(overrides: Record<string, string> = {}) {
  return {
    VITE_FIREBASE_API_KEY: "public-browser-key",
    VITE_FIREBASE_AUTH_DOMAIN: "companion-desk-prod.firebaseapp.com",
    VITE_FIREBASE_DATABASE_URL:
      "https://companion-desk-prod-default-rtdb.europe-west1.firebasedatabase.app",
    VITE_FIREBASE_PROJECT_ID: "companion-desk-prod",
    VITE_FIREBASE_APP_ID: "1:123:web:abc",
    ...overrides,
  };
}

describe("Firebase Tauri release configuration", () => {
  it.each([
    "https://companion-desk-prod-default-rtdb.firebaseio.com",
    "https://companion-desk-prod-default-rtdb.europe-west1.firebasedatabase.app",
  ])("accepts an exact RTDB root and derives exact HTTPS/WSS origins: %s", (databaseURL) => {
    expect(validateFirebaseBuildEnvironment(environment({
      VITE_FIREBASE_DATABASE_URL: databaseURL,
    }))).toMatchObject({
      projectId: "companion-desk-prod",
      databaseURL,
      httpsOrigin: databaseURL,
      wssOrigin: databaseURL.replace("https:", "wss:"),
    });
  });

  it.each([
    { VITE_FIREBASE_AUTH_DOMAIN: "other.firebaseapp.com" },
    { VITE_FIREBASE_DATABASE_URL: "https://other-default-rtdb.firebaseio.com" },
    { VITE_FIREBASE_DATABASE_URL: "https://*.firebaseio.com" },
    { VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.firebaseio.com/path" },
    { VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.firebaseio.com:443" },
    { VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.firebaseio.com/?" },
    { VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.firebaseio.com/#" },
    { VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.bad.region.firebasedatabase.app" },
    { VITE_FIREBASE_PROJECT_ID: "INVALID_PROJECT" },
  ])("rejects unsafe or mismatched build variables %#", (overrides) => {
    expect(() => validateFirebaseBuildEnvironment(environment(overrides))).toThrow();
  });

  it("fails when any required public build variable is missing", () => {
    for (const key of Object.keys(environment())) {
      const candidate = environment();
      delete candidate[key];
      expect(() => validateFirebaseBuildEnvironment(candidate)).toThrow(key);
    }
  });

  it("creates an overlay with exact CSP origins and no Firebase key or app ID", () => {
    const validated = validateFirebaseBuildEnvironment(environment());
    const overlay = createFirebaseTauriOverlay(baseConfig, validated);
    const serialized = JSON.stringify(overlay);
    const csp = overlay.app.security.csp;

    expect(csp).toContain("https://identitytoolkit.googleapis.com");
    expect(csp).toContain("https://securetoken.googleapis.com");
    expect(csp).toContain(validated.httpsOrigin);
    expect(csp).toContain(validated.wssOrigin);
    expect(csp).not.toContain("demo-companion-desk-default-rtdb");
    expect(csp).not.toContain("*.firebase");
    expect(serialized).not.toContain(environment().VITE_FIREBASE_API_KEY);
    expect(serialized).not.toContain(environment().VITE_FIREBASE_APP_ID);
    expect(Object.keys(overlay)).toEqual(["app"]);
  });

  it("adds Google auth and exact RTDB origins to a local-first base policy", () => {
    const validated = validateFirebaseBuildEnvironment(environment());
    const localFirstBase = {
      app: {
        security: {
          csp: "default-src 'self'; connect-src 'self';",
          devCsp: "default-src 'self'; connect-src 'self';",
        },
      },
    };

    const overlay = createFirebaseTauriOverlay(localFirstBase, validated);
    for (const csp of [overlay.app.security.csp, overlay.app.security.devCsp]) {
      expect(csp).toContain("https://identitytoolkit.googleapis.com");
      expect(csp).toContain("https://securetoken.googleapis.com");
      expect(csp).toContain(validated.httpsOrigin);
      expect(csp).toContain(validated.wssOrigin);
    }
  });
});
