import { describe, expect, it } from "vitest";

import { findForbiddenBinaryText } from "../../scripts/scan-binary-paths.mjs";

const forbidden = ["C:\\Users\\runneradmin\\.cargo"];

describe("release binary path scanner", () => {
  it("detects a UTF-8 path", () => {
    expect(findForbiddenBinaryText(Buffer.from(`prefix ${forbidden[0]} suffix`), forbidden))
      .toBe(forbidden[0]);
  });

  it("detects UTF-16LE paths starting at even and odd byte offsets", () => {
    const encoded = Buffer.from(forbidden[0], "utf16le");
    expect(findForbiddenBinaryText(Buffer.concat([Buffer.from([0]), encoded]), forbidden))
      .toBe(forbidden[0]);
    expect(findForbiddenBinaryText(Buffer.concat([Buffer.from([0, 0]), encoded]), forbidden))
      .toBe(forbidden[0]);
  });

  it("returns null for clean binary data", () => {
    expect(findForbiddenBinaryText(Buffer.from("clean /workspace binary"), forbidden)).toBeNull();
  });
});
