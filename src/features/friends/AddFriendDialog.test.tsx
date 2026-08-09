// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FriendSnapshot } from "./types";
import type { FriendsViewModel } from "./useFriends";
import { AddFriendDialog } from "./AddFriendDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function model(overrides: Partial<FriendsViewModel> = {}, snapshot: Partial<FriendSnapshot> = {}): FriendsViewModel {
  return {
    snapshot: {
      connectionState: "ready",
      self: null,
      ownFriendCode: "48271936",
      friends: [],
      pendingRequests: [],
      cooldownsByFriendUid: {},
      incomingPoke: null,
      ...snapshot,
    },
    busy: null,
    error: null,
    actionErrors: {},
    latestErrorAction: null,
    requestByCode: vi.fn(async () => true),
    acceptRequest: vi.fn(async () => true),
    ignoreRequest: vi.fn(async () => true),
    poke: vi.fn(async () => true),
    removeFriend: vi.fn(async () => true),
    resetIdentity: vi.fn(async () => true),
    ...overrides,
  };
}

describe("AddFriendDialog", () => {
  it("shows and copies the user's eight-digit ID", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<AddFriendDialog open onClose={vi.fn()} friends={model()} />);

    expect(screen.getByText("48271936")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制我的好友 ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("48271936"));
  });

  it("validates one eight-digit code and sends a request", async () => {
    const requestByCode = vi.fn(async () => true);
    render(<AddFriendDialog open onClose={vi.fn()} friends={model({ requestByCode })} />);
    const input = screen.getByRole("textbox", { name: "好友 ID" });

    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "发送好友申请" }));
    expect(screen.getByText("请输入 8 位好友 ID")).toBeInTheDocument();
    expect(requestByCode).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "发送好友申请" }));
    await waitFor(() => expect(requestByCode).toHaveBeenCalledWith("87654321"));
  });

  it("accepts or ignores pending requests", () => {
    const acceptRequest = vi.fn(async () => true);
    const ignoreRequest = vi.fn(async () => true);
    render(
      <AddFriendDialog
        open
        onClose={vi.fn()}
        friends={model(
          { acceptRequest, ignoreRequest },
          { pendingRequests: [{ requesterUid: "requester", displayName: "小北", createdAt: 1 }] },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "接受小北的好友申请" }));
    fireEvent.click(screen.getByRole("button", { name: "忽略小北的好友申请" }));
    expect(acceptRequest).toHaveBeenCalledWith("requester");
    expect(ignoreRequest).toHaveBeenCalledWith("requester");
  });

  it("keeps identity reset secondary and requires confirmation", () => {
    const resetIdentity = vi.fn(async () => true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AddFriendDialog open onClose={vi.fn()} friends={model({ resetIdentity })} />);

    fireEvent.click(screen.getByRole("button", { name: "重置好友身份" }));
    expect(resetIdentity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重置好友身份" }));
    expect(resetIdentity).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("stays open when identity reset fails", async () => {
    const onClose = vi.fn();
    const resetIdentity = vi.fn(async () => false);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <AddFriendDialog
        open
        onClose={onClose}
        friends={model({
          resetIdentity,
          actionErrors: { resetIdentity: "重置失败" },
          latestErrorAction: "resetIdentity",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重置好友身份" }));
    await waitFor(() => expect(resetIdentity).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("重置失败")).toBeInTheDocument();
  });

  it("focuses the input, traps Tab, closes on Escape, and restores trigger focus", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { rerender } = render(<AddFriendDialog open onClose={onClose} friends={model()} />);
    const input = screen.getByRole("textbox", { name: "好友 ID" });
    expect(input).toHaveFocus();

    const first = screen.getByRole("button", { name: "关闭添加好友" });
    const copy = screen.getByRole("button", { name: "复制我的好友 ID" });
    const last = screen.getByRole("button", { name: "重置好友身份" });
    expect(first).toBeEnabled();
    expect(copy).toBeEnabled();
    last.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<AddFriendDialog open={false} onClose={onClose} friends={model()} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("clears draft and success state whenever it closes", async () => {
    const requestByCode = vi.fn(async () => true);
    const { rerender } = render(
      <AddFriendDialog open onClose={vi.fn()} friends={model({ requestByCode })} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "好友 ID" }), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "发送好友申请" }));
    await screen.findByText("好友申请已发送");

    rerender(<AddFriendDialog open={false} onClose={vi.fn()} friends={model({ requestByCode })} />);
    rerender(<AddFriendDialog open onClose={vi.fn()} friends={model({ requestByCode })} />);
    expect(screen.getByRole("textbox", { name: "好友 ID" })).toHaveValue("");
    expect(screen.queryByText("好友申请已发送")).not.toBeInTheDocument();
  });
});
