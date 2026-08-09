import { describe, expect, it } from "vitest";
import { validateHostAlias } from "./hostValidation";

describe("validateHostAlias", () => {
  it("accepts an SSH config host alias", () => {
    expect(validateHostAlias("tud-hpc")).toEqual({ ok: true });
    expect(validateHostAlias("cluster.login_1")).toEqual({ ok: true });
  });

  it("rejects shell syntax and blank values", () => {
    const reason = "Use an SSH config host alias containing only letters, digits, dots, underscores, and hyphens.";
    expect(validateHostAlias("host; Remove-Item C:\\")).toEqual({ ok: false, reason });
    expect(validateHostAlias(" ")).toEqual({ ok: false, reason });
    expect(validateHostAlias("-oProxyCommand")).toEqual({ ok: false, reason });
  });
});
