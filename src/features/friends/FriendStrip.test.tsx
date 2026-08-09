// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FriendSnapshot, FriendSummary } from "./types";
import type { FriendsViewModel } from "./useFriends";
import { FriendStrip } from "./FriendStrip";

afterEach(cleanup);

const friends = Array.from({ length: 22 }, (_, index): FriendSummary => ({
  uid: `friend-${index}`,
  displayName: `好友${index + 1}`,
  acceptedAt: index,
}));

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

describe("FriendStrip", () => {
  it("shows loading, unavailable, offline, and empty states without fake friends", () => {
    const { rerender } = render(
      <FriendStrip friends={model({}, { connectionState: "connecting", ownFriendCode: null })} onAdd={vi.fn()} />,
    );
    expect(screen.getByText("正在准备好友功能…")).toBeInTheDocument();

    rerender(<FriendStrip friends={model({ error: "missing config" }, { connectionState: "unavailable" })} onAdd={vi.fn()} />);
    expect(screen.getByText("好友功能暂不可用")).toBeInTheDocument();

    rerender(<FriendStrip friends={model({}, { connectionState: "connecting", ownFriendCode: "48271936" })} onAdd={vi.fn()} />);
    expect(screen.getByText("当前离线")).toBeInTheDocument();
    expect(screen.queryByText("还没有好友")).not.toBeInTheDocument();

    rerender(<FriendStrip friends={model()} onAdd={vi.fn()} />);
    expect(screen.getByText("还没有好友")).toBeInTheDocument();
    expect(screen.queryByText(/Momo|阿杰|小雨/)).not.toBeInTheDocument();
  });

  it("renders only twenty accepted friends and opens the add dialog", () => {
    const onAdd = vi.fn();
    render(<FriendStrip friends={model({}, { friends })} onAdd={onAdd} />);

    expect(screen.getAllByTestId("friend-entry")).toHaveLength(20);
    expect(screen.queryByRole("button", { name: "好友21" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加好友" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("makes poke the primary action and honors cooldown, offline, and busy states", () => {
    const poke = vi.fn(async () => true);
    const accepted = [friends[0]];
    const { rerender } = render(
      <FriendStrip friends={model({ poke }, { friends: accepted })} onAdd={vi.fn()} now={10_000} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "好友1" }));
    fireEvent.click(screen.getByRole("button", { name: "戳一下好友1" }));
    expect(poke).toHaveBeenCalledWith("friend-0");

    rerender(
      <FriendStrip
        friends={model({}, { friends: accepted, cooldownsByFriendUid: { "friend-0": 9_990 } })}
        onAdd={vi.fn()}
        now={10_000}
      />,
    );
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();

    rerender(<FriendStrip friends={model({}, { connectionState: "connecting", ownFriendCode: "48271936", friends: accepted })} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();

    rerender(<FriendStrip friends={model({ busy: "removeFriend" }, { friends: accepted })} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();
  });

  it("requires confirmation before removing a friend", () => {
    const removeFriend = vi.fn(async () => true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<FriendStrip friends={model({ removeFriend }, { friends: [friends[0]] })} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "好友1" }));

    fireEvent.click(screen.getByRole("button", { name: "删除好友1" }));
    expect(removeFriend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除好友1" }));
    expect(removeFriend).toHaveBeenCalledWith("friend-0");
    confirm.mockRestore();
  });

  it("shows rejected poke and remove errors in place", () => {
    const accepted = [friends[0]];
    const { rerender } = render(
      <FriendStrip
        friends={model({
          actionErrors: { poke: "网络中断，戳一下失败" },
          latestErrorAction: "poke",
        }, { friends: accepted })}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("网络中断，戳一下失败");

    rerender(
      <FriendStrip
        friends={model({
          actionErrors: { poke: "旧错误", removeFriend: "删除失败，请重试" },
          latestErrorAction: "removeFriend",
        }, { friends: accepted })}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("删除失败，请重试");
  });

  it("automatically re-enables poke when the nearest cooldown expires and cleans its timer", () => {
    let now = 10_000;
    let callback: (() => void) | null = null;
    const cancelTimer = vi.fn();
    render(
      <FriendStrip
        friends={model({}, {
          friends: [friends[0]],
          cooldownsByFriendUid: { "friend-0": 9_000 },
        })}
        onAdd={vi.fn()}
        clock={() => now}
        scheduleTimer={(next) => {
          callback = next;
          return 7;
        }}
        cancelTimer={cancelTimer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "好友1" }));
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();

    now = 39_000;
    act(() => { callback?.(); });
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeEnabled();
    cleanup();
    expect(cancelTimer).toHaveBeenCalledWith(7);
  });

  it("uses a non-modal action group and restores avatar focus on Escape", () => {
    render(<FriendStrip friends={model({}, { friends: [friends[0]] })} onAdd={vi.fn()} />);
    const avatar = screen.getByRole("button", { name: "好友1" });
    fireEvent.click(avatar);
    const group = screen.getByRole("group", { name: "好友1 操作" });
    expect(screen.queryByRole("dialog", { name: "好友1 操作" })).not.toBeInTheDocument();

    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "好友1 操作" })).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });

  it("keeps an enabled action focused so Escape works while poke is offline or cooling down", () => {
    const accepted = [friends[0]];
    const { rerender } = render(
      <FriendStrip
        friends={model({}, {
          connectionState: "connecting",
          ownFriendCode: "48271936",
          friends: accepted,
        })}
        onAdd={vi.fn()}
      />,
    );
    let avatar = screen.getByRole("button", { name: "好友1" });
    fireEvent.click(avatar);
    const remove = screen.getByRole("button", { name: "删除好友1" });
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Escape" });
    expect(avatar).toHaveFocus();

    rerender(
      <FriendStrip
        friends={model({}, {
          friends: accepted,
          cooldownsByFriendUid: { "friend-0": 9_999 },
        })}
        onAdd={vi.fn()}
        now={10_000}
      />,
    );
    avatar = screen.getByRole("button", { name: "好友1" });
    fireEvent.click(avatar);
    expect(screen.getByRole("button", { name: "删除好友1" })).toHaveFocus();
  });

  it("does not steal focus when the selected friend's snapshot object updates", () => {
    const accepted = [friends[0]];
    const { rerender } = render(
      <FriendStrip friends={model({}, { friends: accepted })} onAdd={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "好友1" }));
    const add = screen.getByRole("button", { name: "添加好友" });
    add.focus();

    rerender(
      <FriendStrip
        friends={model({}, { friends: [{ ...accepted[0], acceptedAt: 2 }] })}
        onAdd={vi.fn()}
      />,
    );
    expect(add).toHaveFocus();
  });

  it("focuses the action group while busy and keeps Escape available without stealing focus on recovery", () => {
    const accepted = [friends[0]];
    const { rerender } = render(
      <FriendStrip
        friends={model({ busy: "removeFriend" }, { friends: accepted })}
        onAdd={vi.fn()}
      />,
    );
    const avatar = screen.getByRole("button", { name: "好友1" });
    fireEvent.click(avatar);
    const group = screen.getByRole("group", { name: "好友1 操作" });
    expect(screen.getByRole("button", { name: "戳一下好友1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除好友1" })).toBeDisabled();
    expect(group).toHaveFocus();

    const add = screen.getByRole("button", { name: "添加好友" });
    add.focus();
    rerender(
      <FriendStrip
        friends={model({}, { friends: accepted })}
        onAdd={vi.fn()}
      />,
    );
    expect(add).toHaveFocus();

    group.focus();
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "好友1 操作" })).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });
});
