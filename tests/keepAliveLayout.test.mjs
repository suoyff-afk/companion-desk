import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("keep-alive feature layout", () => {
  it("constrains feature content to the available main viewport", () => {
    const applicationStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const declaration = applicationStyles.match(/\.feature-keep-alive\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(declaration).toMatch(/(?:^|;)\s*height:\s*100%\s*(?:;|$)/);
    expect(declaration).toMatch(/(?:^|;)\s*min-height:\s*0\s*(?:;|$)/);
  });

  it("keeps the collapsed pet inside one 104px sprite-sheet row", () => {
    const applicationStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const declaration = applicationStyles.match(/\.pet-dock--collapsed \.pet-dock__sprite\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(declaration).toMatch(/(?:^|;)\s*height:\s*104px\s*(?:;|$)/);
  });
});
