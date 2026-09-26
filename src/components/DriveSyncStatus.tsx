"use client";

import { useDriveSyncStore } from "@/lib/store/driveSyncStore";

const STATUS_LABEL: Record<string, string> = {
  "signed-out": "Not connected",
  idle: "Synced",
  syncing: "Syncing…",
  conflict: "Conflict!",
  "needs-auth": "Drive sign-in expired",
  error: "Sync error",
};

export function DriveSyncStatus() {
  const { status, fileRef, error, connect, resume, disconnect } = useDriveSyncStore();

  if (status === "signed-out") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => void connect()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
        >
          Connect Google Drive
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  const dotColor =
    status === "idle"
      ? "bg-emerald-500"
      : status === "syncing" || status === "needs-auth"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-neutral-600" title={error ?? undefined}>
        {STATUS_LABEL[status]}
        {fileRef && status !== "error" && status !== "needs-auth" ? ` · ${fileRef.name}` : ""}
      </span>
      {status === "needs-auth" && (
        <>
          <span className="text-xs text-neutral-500">Changes since then aren&apos;t on Drive yet; keep this tab open.</span>
          <button onClick={() => void resume()} className="text-xs font-medium text-blue-600 hover:underline">
            Sign in again
          </button>
        </>
      )}
      {status === "error" && (
        // Resume, not connect: connect reloads the file from Drive over any unsynced edits.
        <button onClick={() => void resume()} className="text-xs text-blue-600 hover:underline">
          Retry
        </button>
      )}
      <button onClick={disconnect} className="text-xs text-neutral-400 hover:text-neutral-600">
        Disconnect
      </button>
    </div>
  );
}

export function DriveConflictBanner() {
  const { status, conflict, resolveConflict } = useDriveSyncStore();
  if (status !== "conflict" || !conflict) return null;

  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <p className="mb-2 font-medium">
        This file changed on Google Drive since your last sync (probably edited on another device).
        Which version do you want to keep?
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void resolveConflict("local")}
          className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-100"
        >
          Keep my local changes (overwrite Drive)
        </button>
        <button
          onClick={() => void resolveConflict("remote")}
          className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-100"
        >
          Keep the Drive version (discard local changes)
        </button>
      </div>
    </div>
  );
}
