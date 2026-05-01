/**
 * Registry of active sessions. One entry per live `claude -p` subprocess.
 *
 * Keyed by the *local session id* assigned when the client first connects
 * (before Claude's own session_id is known via the init event). The local id
 * is stable across the subprocess lifetime. Claude's authoritative session
 * id is available via `session.getClaudeSessionId()` once the init event
 * has fired, and is what we use for `--resume` and persistence lookups.
 */

import { Session, type SessionStartOptions } from "./session.js";

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(
    opts: SessionStartOptions & { resumeSessionId?: string; localId?: string },
  ): Session {
    // Pass through an optional caller-supplied local id so the WS handler can
    // pre-allocate it (e.g. to register sessionSockets before the claude
    // subprocess is spawned, which lets history replay happen first).
    const session = new Session({
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      localId: opts.localId,
      enabledIntegrations: opts.enabledIntegrations,
      extraMcpServers: opts.extraMcpServers,
    });
    this.sessions.set(session.id, session);
    session.start({ resumeSessionId: opts.resumeSessionId });
    return session;
  }

  get(localId: string): Session | undefined {
    return this.sessions.get(localId);
  }

  remove(localId: string) {
    const session = this.sessions.get(localId);
    if (!session) return;
    session.stop();
    this.sessions.delete(localId);
  }

  stopAll() {
    for (const s of this.sessions.values()) s.stop();
    this.sessions.clear();
  }
}

export const sessionManager = new SessionManager();
