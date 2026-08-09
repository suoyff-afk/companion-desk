import { HandTap, Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { FRIEND_DISPLAY_LIMIT, POKE_COOLDOWN_MS, canSendPoke } from "./friendLogic";
import type { FriendSummary } from "./types";
import type { FriendsViewModel } from "./useFriends";

interface FriendStripProps {
  friends: FriendsViewModel;
  onAdd: () => void;
  now?: number;
  clock?: () => number;
  scheduleTimer?: (callback: () => void, delay: number) => unknown;
  cancelTimer?: (handle: unknown) => void;
}

function friendInitial(friend: FriendSummary): string {
  return Array.from(friend.displayName.trim())[0] ?? "友";
}

export function FriendStrip({
  friends,
  onAdd,
  now,
  clock = Date.now,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: FriendStripProps) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [, refreshCooldowns] = useState(0);
  const avatarRefs = useRef(new Map<string, HTMLButtonElement>());
  const actionGroupRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const removeActionRef = useRef<HTMLButtonElement>(null);
  const { snapshot, busy } = friends;
  const currentTime = now ?? clock();
  const visibleFriends = snapshot.friends.slice(0, FRIEND_DISPLAY_LIMIT);
  const selected = visibleFriends.find((friend) => friend.uid === selectedUid) ?? null;
  const loading = snapshot.connectionState === "connecting" && snapshot.ownFriendCode === null;
  const offline = snapshot.connectionState === "connecting" && snapshot.ownFriendCode !== null;
  const actionError = friends.latestErrorAction === "poke" || friends.latestErrorAction === "removeFriend"
    ? friends.actionErrors[friends.latestErrorAction] ?? null
    : null;

  useEffect(() => {
    if (now !== undefined) return;
    const current = clock();
    const nearestExpiry = Object.values(snapshot.cooldownsByFriendUid)
      .map((sentAt) => sentAt + POKE_COOLDOWN_MS)
      .filter((expiresAt) => expiresAt > current)
      .sort((left, right) => left - right)[0];
    if (nearestExpiry === undefined) return;
    const handle = scheduleTimer(
      () => refreshCooldowns((version) => version + 1),
      nearestExpiry - current,
    );
    return () => cancelTimer(handle);
  }, [cancelTimer, clock, now, scheduleTimer, snapshot.cooldownsByFriendUid]);

  useEffect(() => {
    if (selectedUid === null) return;
    const primary = primaryActionRef.current;
    if (primary !== null && !primary.disabled) primary.focus();
    else {
      const remove = removeActionRef.current;
      if (remove !== null && !remove.disabled) remove.focus();
      else actionGroupRef.current?.focus();
    }
  }, [selectedUid]);

  const closePopover = () => {
    const uid = selectedUid;
    setSelectedUid(null);
    if (uid !== null) avatarRefs.current.get(uid)?.focus();
  };

  const remove = (friend: FriendSummary) => {
    if (!window.confirm(`删除好友 ${friend.displayName}？`)) return;
    closePopover();
    void friends.removeFriend(friend.uid);
  };

  return (
    <section className="home-friends" aria-labelledby="friends-title">
      <h2 id="friends-title">好友</h2>
      <div className="home-friends__body">
        {loading && <p className="friend-strip__status" role="status">正在准备好友功能…</p>}
        {snapshot.connectionState === "unavailable" && (
          <p className="friend-strip__status friend-strip__status--error">好友功能暂不可用</p>
        )}
        {offline && <p className="friend-strip__status">当前离线</p>}
        {actionError && <p className="friend-strip__action-error" role="alert">{actionError}</p>}
        {snapshot.connectionState === "ready" && visibleFriends.length === 0 && (
          <p className="friend-strip__status">还没有好友</p>
        )}

        <div className="home-friends__list" aria-label="好友列表">
          {visibleFriends.map((friend) => (
            <div className="friend-entry" data-testid="friend-entry" key={friend.uid}>
              <button
                type="button"
                className={`friend-avatar${selectedUid === friend.uid ? " is-selected" : ""}`}
                aria-label={friend.displayName}
                aria-expanded={selectedUid === friend.uid}
                ref={(element) => {
                  if (element === null) avatarRefs.current.delete(friend.uid);
                  else avatarRefs.current.set(friend.uid, element);
                }}
                onClick={() => setSelectedUid((current) => current === friend.uid ? null : friend.uid)}
              >
                <span aria-hidden="true">{friendInitial(friend)}</span>
              </button>
              <small title={friend.displayName}>{friend.displayName}</small>
            </div>
          ))}
          <div className="friend-entry">
            <button type="button" className="friend-avatar friend-avatar--add" aria-label="添加好友" onClick={onAdd}>
              <Plus aria-hidden="true" />
            </button>
            <small>添加</small>
          </div>
        </div>

        {selected && (
          <div
            className="friend-popover"
            role="group"
            ref={actionGroupRef}
            tabIndex={-1}
            aria-label={`${selected.displayName} 操作`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePopover();
              }
            }}
          >
            <strong>{selected.displayName}</strong>
            <button
              type="button"
              ref={primaryActionRef}
              className="friend-popover__primary"
              aria-label={`戳一下${selected.displayName}`}
              disabled={
                snapshot.connectionState !== "ready"
                || busy !== null
                || !canSendPoke(currentTime, snapshot.cooldownsByFriendUid[selected.uid] ?? null)
              }
              onClick={() => { void friends.poke(selected.uid); }}
            >
              <HandTap weight="duotone" />
              戳一下
            </button>
            <button
              type="button"
              className="friend-popover__remove"
              ref={removeActionRef}
              aria-label={`删除${selected.displayName}`}
              disabled={busy !== null}
              onClick={() => remove(selected)}
            >
              <Trash />
              删除好友
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
