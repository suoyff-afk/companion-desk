import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const tauriConfig = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

describe("home glass layout", () => {
  it("starts with the collapsed pet geometry before React mounts", () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({ width: 160, height: 150 });
  });

  it("disables the rectangular native shadow on the transparent rounded window", () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({
      alwaysOnTop: false,
      decorations: false,
      transparent: true,
      shadow: false,
    });
    expect(tauriConfig.app.windows[0]).not.toHaveProperty("windowEffects");
  });

  it("uses the app shell as the only full-page glass contour", () => {
    const homeMain = rule('.app-main[data-view="home"]');

    expect(homeMain).toMatch(/border:\s*0\s*;/);
    expect(homeMain).toMatch(/border-radius:\s*0\s*;/);
    expect(homeMain).toMatch(/background:\s*transparent\s*;/);
    expect(homeMain).toMatch(/box-shadow:\s*none\s*;/);
    expect(homeMain).toMatch(/backdrop-filter:\s*none\s*;/);
  });

  it("uses a readable translucent home fill without drawing an outer border", () => {
    const appShell = rule(".app-shell");
    const homeShell = rule('.app-shell[data-view="home"]');

    expect(appShell).toMatch(/border:\s*0\s*;/);
    expect(appShell).toMatch(/rgb\(253,\s*254,\s*255\)/);
    expect(appShell).toMatch(/rgb\(229,\s*236,\s*251\)/);
    expect(homeShell).toMatch(/border:\s*0\s*;/);
    expect(homeShell).toMatch(/rgba\(253,\s*254,\s*255,\s*\.9\)/);
    expect(homeShell).toMatch(/rgba\(230,\s*237,\s*251,\s*\.82\)/);
  });

  it("keeps the normal home compact but allows exceptional content to scroll", () => {
    const homeMain = rule('.app-main[data-view="home"]');
    const homePage = rule(".home-page");

    expect(homeMain).toMatch(/overflow-x:\s*hidden\s*;/);
    expect(homeMain).toMatch(/overflow-y:\s*auto\s*;/);
    expect(homePage).toMatch(/min-height:\s*100%\s*;/);
    expect(homePage).toMatch(/height:\s*auto\s*;/);
    expect(homePage).toMatch(/overflow:\s*visible\s*;/);
  });

  it("fits every normal home state inside its compact native height", () => {
    const homePage = rule(".home-page");
    const quota = rule(".home-quota");
    const quotaHeading = rule(".home-quota__heading");
    const refresh = rule(".home-quota__refresh");
    const quotaRow = rule(".home-quota__row");
    const primaryAction = rule(".home-action");
    const more = rule(".home-more");
    const moreToggle = rule(".home-more__toggle");
    const moreAction = rule(".home-more__actions button");
    const friends = rule(".home-friends");
    const friendStatus = rule(".friend-strip__status");

    expect(homePage).toMatch(/gap:\s*7px\s*;/);
    expect(homePage).toMatch(/padding:\s*6px\s+10px\s+8px\s*;/);
    expect(quota).toMatch(/gap:\s*3px\s*;/);
    expect(quota).toMatch(/padding:\s*7px\s+11px\s+8px\s*;/);
    expect(quotaHeading).toMatch(/min-height:\s*22px\s*;/);
    expect(refresh).toMatch(/width:\s*22px\s*;/);
    expect(refresh).toMatch(/height:\s*22px\s*;/);
    expect(quotaRow).toMatch(/min-height:\s*24px\s*;/);
    expect(primaryAction).toMatch(/min-height:\s*46px\s*;/);
    expect(more).toMatch(/min-height:\s*25px\s*;/);
    expect(moreToggle).toMatch(/min-height:\s*24px\s*;/);
    expect(moreAction).toMatch(/min-height:\s*31px\s*;/);
    expect(friends).toMatch(/padding:\s*6px\s+4px\s+0\s*;/);
    expect(friendStatus).toMatch(/min-height:\s*14px\s*;/);
  });

  it("keeps the friend strip unframed instead of adding another rounded card", () => {
    const friends = rule(".home-friends");

    expect(friends).toMatch(/border:\s*0\s*;/);
    expect(friends).toMatch(/border-top:/);
    expect(friends).toMatch(/border-radius:\s*0\s*;/);
    expect(friends).toMatch(/background:\s*transparent\s*;/);
  });
});
