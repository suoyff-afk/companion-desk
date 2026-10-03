import { TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readAppValue, writeAppValue } from "../../lib/persistence";
import { validateHostAlias } from "./hostValidation";
import { createXtermTerminal, TerminalPanel, type TerminalFactory } from "./TerminalPanel";
import { desktopTerminalBridge, type TerminalBridge } from "./terminalBridge";
import { HpcTaskBoard } from "./HpcTaskBoard";
import type { HpcQueryBridge } from "./hpcQueryBridge";

interface HpcPageProps {
  terminalBridge?: TerminalBridge;
  terminalFactory?: TerminalFactory;
  queryBridge?: HpcQueryBridge;
}

export function HpcPage({ terminalBridge = desktopTerminalBridge, terminalFactory = createXtermTerminal, queryBridge }: HpcPageProps) {
  const [hostAlias, setHostAlias] = useState("");
  const hostEdited = useRef(false);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const validation = useMemo(() => validateHostAlias(hostAlias), [hostAlias]);
  const hostAliasEmpty = hostAlias.trim().length === 0;

  useEffect(() => {
    let active = true;
    void readAppValue<{ hostAlias?: string }>("hpc", {}).then((value) => {
      if (active && !hostEdited.current && typeof value.hostAlias === "string" && validateHostAlias(value.hostAlias).ok) setHostAlias(value.hostAlias);
    }).catch(() => {
      if (active) setPersistenceNotice("Saved SSH host could not be loaded. Enter it again to continue.");
    });
    return () => { active = false; };
  }, []);

  const rememberHost = () => {
    void writeAppValue("hpc", { hostAlias })
      .then(() => setPersistenceNotice(null))
      .catch(() => setPersistenceNotice("SSH host could not be saved. It will retry on the next connection."));
  };

  return (
    <section className="feature-page hpc-page" aria-label="HPC / SSH">
      <div className="hpc-layout">
        <div className="hpc-primary">
          <TerminalPanel
            hostAlias={hostAlias}
            hostValid={validation.ok}
            bridge={terminalBridge}
            terminalFactory={terminalFactory}
            onConnected={rememberHost}
            connectionFields={(
              <>
                {persistenceNotice && <p className="field-error" role="alert">{persistenceNotice}</p>}
                <label htmlFor="ssh-host"><TerminalWindow /><span>SSH host alias</span></label>
                <div className="ssh-host-field">
                  <input
                    id="ssh-host"
                    aria-label="SSH host alias"
                    value={hostAlias}
                    onChange={(event) => {
                      hostEdited.current = true;
                      setHostAlias(event.target.value);
                    }}
                    aria-invalid={!hostAliasEmpty && !validation.ok}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="例如：tud-hpc"
                  />
                  {!hostAliasEmpty && !validation.ok && <small className="field-error">{validation.reason}</small>}
                </div>
                <div className="ssh-guidance">
                  <small className="ssh-security-note">Windows SSH config · terminal content is not saved</small>
                  <details className="ssh-config-example">
                    <summary>查看 SSH 配置示例</summary>
                    <pre aria-label="SSH 配置示例">{`Host tud-hpc
    HostName login.cluster.example.edu
    User your-username
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes`}</pre>
                  </details>
                </div>
              </>
            )}
          />
        </div>
        <HpcTaskBoard hostAlias={hostAlias} hostValid={validation.ok} bridge={queryBridge} />
      </div>
    </section>
  );
}
