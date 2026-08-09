import { Check, Copy, UserPlus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { normalizeFriendCode } from "./friendLogic";
import type { FriendsViewModel } from "./useFriends";

interface AddFriendDialogProps {
  open: boolean;
  onClose: () => void;
  friends: FriendsViewModel;
}

export function AddFriendDialog({ open, onClose, friends }: AddFriendDialogProps) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { snapshot, busy } = friends;
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogActions = new Set(["requestByCode", "acceptRequest", "ignoreRequest", "resetIdentity"]);
  const actionError = friends.latestErrorAction !== null && dialogActions.has(friends.latestErrorAction)
    ? friends.actionErrors[friends.latestErrorAction] ?? null
    : null;

  useEffect(() => {
    if (!open) {
      setCode("");
      setMessage(null);
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus();
    return () => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const closeDialog = () => {
    setCode("");
    setMessage(null);
    onClose();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const allFocusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const first = allFocusable[0] ?? null;
    const last = allFocusable.at(-1) ?? null;
    if (first === null || last === null) return;
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  };

  const copyCode = async () => {
    if (snapshot.ownFriendCode === null || !navigator.clipboard?.writeText) {
      setMessage("暂时无法复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(snapshot.ownFriendCode);
      setMessage("已复制");
    } catch {
      setMessage("暂时无法复制");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeFriendCode(code);
    if (normalized === null) {
      setMessage("请输入 8 位好友 ID");
      return;
    }
    const sent = await friends.requestByCode(normalized);
    if (sent) {
      setCode("");
      setMessage("好友申请已发送");
    }
  };

  const reset = async () => {
    if (!window.confirm("重置后会失去当前好友和好友 ID，确定继续吗？")) return;
    const resetDone = await friends.resetIdentity();
    if (resetDone) closeDialog();
  };

  return (
    <div className="friend-dialog-backdrop" role="presentation">
      <section
        className="friend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friend-dialog-title"
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="friend-dialog__header">
          <div>
            <h2 id="friend-dialog-title">添加好友</h2>
            <p>用 8 位 ID 建立一个轻量连接。</p>
          </div>
          <button type="button" aria-label="关闭添加好友" onClick={closeDialog}><X /></button>
        </header>

        <div className="friend-dialog__scroll">
          <section className="friend-id-card" aria-label="我的好友 ID">
            <span>我的好友 ID</span>
            <strong>{snapshot.ownFriendCode ?? "--------"}</strong>
            <button
              type="button"
              aria-label="复制我的好友 ID"
              disabled={snapshot.ownFriendCode === null}
              onClick={() => { void copyCode(); }}
            >
              <Copy />
              复制
            </button>
          </section>

          <form className="friend-request-form" onSubmit={(event) => { void submit(event); }}>
            <label htmlFor="friend-code">好友 ID</label>
            <div>
              <input
                id="friend-code"
                ref={inputRef}
                value={code}
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                placeholder="输入 8 位数字"
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 8));
                  setMessage(null);
                }}
              />
              <button type="submit" disabled={busy !== null || snapshot.connectionState !== "ready"}>
                <UserPlus />
                发送好友申请
              </button>
            </div>
          </form>

          {message && <p className="friend-dialog__message" role="status">{message}</p>}
          {(actionError ?? friends.error) && (
            <p className="friend-dialog__message friend-dialog__message--error" role="alert">
              {actionError ?? friends.error}
            </p>
          )}

          <section className="friend-requests" aria-labelledby="friend-requests-title">
            <h3 id="friend-requests-title">待处理申请</h3>
            {snapshot.pendingRequests.length === 0 ? (
              <p>暂无新申请</p>
            ) : snapshot.pendingRequests.map((request) => (
              <article key={request.requesterUid}>
                <span aria-hidden="true">{Array.from(request.displayName)[0] ?? "友"}</span>
                <strong>{request.displayName}</strong>
                <button
                  type="button"
                  aria-label={`接受${request.displayName}的好友申请`}
                  disabled={busy !== null}
                  onClick={() => { void friends.acceptRequest(request.requesterUid); }}
                >
                  <Check />
                  接受
                </button>
                <button
                  type="button"
                  aria-label={`忽略${request.displayName}的好友申请`}
                  disabled={busy !== null}
                  onClick={() => { void friends.ignoreRequest(request.requesterUid); }}
                >
                  忽略
                </button>
              </article>
            ))}
          </section>

          <button
            type="button"
            className="friend-dialog__reset"
            disabled={busy !== null}
            onClick={() => { void reset(); }}
          >
            重置好友身份
          </button>
        </div>
      </section>
    </div>
  );
}
