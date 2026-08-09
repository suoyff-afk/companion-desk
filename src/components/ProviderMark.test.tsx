// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderMark } from "./ProviderMark";

afterEach(cleanup);

describe("ProviderMark", () => {
  it("uses a neutral inline icon while retaining the provider label", () => {
    render(<ProviderMark />);

    const mark = screen.getByRole("img", { name: "Codex" });
    expect(mark).toContainHTML("<svg");
    expect(mark.querySelector("img")).not.toBeInTheDocument();
  });
});
