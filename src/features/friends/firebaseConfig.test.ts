import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { readFirebaseWebConfig, type FirebaseWebEnvironment } from "./firebaseConfig";

const demoProjectId = "demo-companion-desk";
const exactDatabaseUrls = [
  "https://demo-companion-desk-default-rtdb.firebaseio.com",
  "https://demo-companion-desk-default-rtdb.europe-west1.firebasedatabase.app",
];

function demoEnvironment(overrides: FirebaseWebEnvironment = {}): FirebaseWebEnvironment {
  return {
    VITE_FIREBASE_API_KEY: "public-key",
    VITE_FIREBASE_AUTH_DOMAIN: "demo-companion-desk.firebaseapp.com",
    VITE_FIREBASE_DATABASE_URL: exactDatabaseUrls[0],
    VITE_FIREBASE_PROJECT_ID: demoProjectId,
    VITE_FIREBASE_APP_ID: "1:1:web:1",
    ...overrides,
  };
}

describe("readFirebaseWebConfig", () => {
  it("is unavailable when required public Firebase settings are absent", () => {
    expect(readFirebaseWebConfig({})).toEqual({ status: "unavailable" });
  });

  it("normalizes a complete demo configuration without accepting admin fields", () => {
    expect(readFirebaseWebConfig(demoEnvironment({
      VITE_FIREBASE_AUTH_DOMAIN: " demo-companion-desk.firebaseapp.com ",
      VITE_FIREBASE_DATABASE_URL: `${exactDatabaseUrls[1]}/`,
      VITE_FIREBASE_PROJECT_ID: ` ${demoProjectId} `,
      FIREBASE_SERVICE_ACCOUNT: "must-not-be-read",
    }))).toMatchObject({
      status: "ready",
      projectId: demoProjectId,
      databaseURL: exactDatabaseUrls[1],
      useEmulator: false,
    });
  });

  it("enables the emulator only for the literal true flag", () => {
    expect(readFirebaseWebConfig(demoEnvironment({ VITE_FIREBASE_USE_EMULATOR: "true" })))
      .toMatchObject({ status: "ready", useEmulator: true });
  });

  it("accepts the exact demo RTDB root URLs", () => {
    for (const databaseURL of exactDatabaseUrls) {
      expect(readFirebaseWebConfig(demoEnvironment({ VITE_FIREBASE_DATABASE_URL: databaseURL })))
        .toMatchObject({ status: "ready", databaseURL });
    }
  });

  it("accepts a production-like project when auth and RTDB hosts match it", () => {
    expect(readFirebaseWebConfig(demoEnvironment({
      VITE_FIREBASE_PROJECT_ID: "companion-desk-prod",
      VITE_FIREBASE_AUTH_DOMAIN: "companion-desk-prod.firebaseapp.com",
      VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.europe-west1.firebasedatabase.app",
    }))).toMatchObject({
      status: "ready",
      projectId: "companion-desk-prod",
      databaseURL: "https://companion-desk-prod-default-rtdb.europe-west1.firebasedatabase.app",
    });
  });

  it("rejects invalid project IDs and project/auth/database mismatches", () => {
    for (const overrides of [
      { VITE_FIREBASE_PROJECT_ID: "-invalid" },
      { VITE_FIREBASE_PROJECT_ID: "UPPERCASE" },
      {
        VITE_FIREBASE_PROJECT_ID: "companion-desk-prod",
        VITE_FIREBASE_AUTH_DOMAIN: "other-project.firebaseapp.com",
        VITE_FIREBASE_DATABASE_URL: "https://companion-desk-prod-default-rtdb.firebaseio.com",
      },
      {
        VITE_FIREBASE_PROJECT_ID: "companion-desk-prod",
        VITE_FIREBASE_AUTH_DOMAIN: "companion-desk-prod.firebaseapp.com",
        VITE_FIREBASE_DATABASE_URL: "https://other-project-default-rtdb.firebaseio.com",
      },
    ]) {
      expect(readFirebaseWebConfig(demoEnvironment(overrides))).toEqual({ status: "unavailable" });
    }
  });

  it("rejects non-root URL components and a non-default port", () => {
    for (const databaseURL of [
      `${exactDatabaseUrls[0]}/nested`,
      `${exactDatabaseUrls[0]}?query=1`,
      `${exactDatabaseUrls[0]}#fragment`,
      "https://user@demo-companion-desk-default-rtdb.firebaseio.com",
      "https://demo-companion-desk-default-rtdb.firebaseio.com:444",
      "https://demo-companion-desk-default-rtdb.firebaseio.com:443",
      "https://demo-companion-desk-default-rtdb.firebaseio.com/?",
      "https://demo-companion-desk-default-rtdb.firebaseio.com/#",
      "https://demo-companion-desk-default-rtdb.bad-region.firebasedatabase.app",
      "https://*.firebaseio.com",
    ]) {
      expect(readFirebaseWebConfig(demoEnvironment({ VITE_FIREBASE_DATABASE_URL: databaseURL })))
        .toEqual({ status: "unavailable" });
    }
  });

  // The local-first artifact keeps online origins in its future-development policy only.
  it("keeps online Firebase origins out of production CSP and localhost only in devCsp", async () => {
    const tauriConfig = JSON.parse(await readFile(new URL("../../../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
      app: { security: { csp: string; devCsp: string } };
    };
    const { csp, devCsp } = tauriConfig.app.security;

    for (const databaseURL of exactDatabaseUrls) {
      const ready = readFirebaseWebConfig(demoEnvironment({ VITE_FIREBASE_DATABASE_URL: databaseURL }));
      expect(ready.status).toBe("ready");
      if (ready.status !== "ready") continue;

      const httpsOrigin = new URL(ready.databaseURL).origin;
      const wssOrigin = httpsOrigin.replace("https:", "wss:");
      expect(csp).not.toContain(httpsOrigin);
      expect(csp).not.toContain(wssOrigin);
      expect(devCsp).toContain(httpsOrigin);
      expect(devCsp).toContain(wssOrigin);
    }
    expect(csp).not.toContain("127.0.0.1");
    expect(csp).not.toContain("*.firebase");
    expect(devCsp).toContain("http://127.0.0.1:9000");
    expect(devCsp).toContain("ws://127.0.0.1:9000");
  });
});
