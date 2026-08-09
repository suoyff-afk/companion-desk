export type HostValidation = { ok: true } | { ok: false; reason: string };

const HOST_ALIAS_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/;
const INVALID_REASON = "Use an SSH config host alias containing only letters, digits, dots, underscores, and hyphens.";

export function validateHostAlias(value: string): HostValidation {
  return HOST_ALIAS_PATTERN.test(value)
    ? { ok: true }
    : { ok: false, reason: INVALID_REASON };
}
