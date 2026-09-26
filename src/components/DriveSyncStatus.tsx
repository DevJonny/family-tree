"use client";

import { useDriveSyncStore } from "@/lib/store/driveSyncStore";

const STATUS_LABEL: Record<string, string> = {
  "signed-out": "Not connected",
  idle: "Synced",
  syncing: "Syncing…",
  conflict: "Conflict!",
  "needs-auth": "Drive sign-in expired",
  "choosing-file": "Choose a file",
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
      : status === "syncing" || status === "needs-auth" || status === "choosing-file"
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

const CONFLICT_COPY = {
  connect: {
    message: (name: string) =>
      `Google Drive already has ${name}, and it's different from the tree open here. Which one do you want to keep?`,
    keepLocal: "Keep the tree open here (replace the Drive file)",
    keepRemote: "Load the Drive file (discard the tree open here)",
  },
  "remote-changed": {
    message: () =>
      "This file changed on Google Drive since your last sync (probably edited on another device). Which version do you want to keep?",
    keepLocal: "Keep my local changes (overwrite Drive)",
    keepRemote: "Keep the Drive version (discard local changes)",
  },
};

export function DriveConflictBanner() {
  const { status, conflict, resolveConflict, disconnect } = useDriveSyncStore();
  if (status !== "conflict" || !conflict) return null;
  const copy = CONFLICT_COPY[conflict.reason];
  const button = "rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium hover:bg-red-100";

  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <p className="mb-2 font-medium">{copy.message(conflict.remote.file.name)}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void resolveConflict("local")} className={button}>
          {copy.keepLocal}
        </button>
        <button onClick={() => void resolveConflict("remote")} className={button}>
          {copy.keepRemote}
        </button>
        {conflict.reason === "connect" && (
          <button onClick={disconnect} className="px-2 py-1 text-xs text-red-700 hover:underline">
            Cancel (don&apos;t connect)
          </button>
        )}
      </div>
    </div>
  );
}

/** First connect with several files in the Drive folder: which one is this tree? */
export function DriveFilePicker() {
  const { status, fileChoices, pickFile, disconnect } = useDriveSyncStore();
  if (status !== "choosing-file" || !fileChoices) return null;

  return (
    <div role="dialog" aria-label="Choose a Google Drive file" className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      <p className="mb-2 font-medium">
        Your Google Drive folder has {fileChoices.length} family tree files. Which one do you want to use here?
      </p>
      <ul className="mb-2 space-y-1">
        {fileChoices.map((file) => (
          <li key={file.fileId}>
            <button
              onClick={() => void pickFile(file.fileId)}
              className="flex w-full items-baseline justify-between gap-3 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-left hover:bg-blue-100"
            >
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-blue-700">last changed {formatModified(file.modifiedTime)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button onClick={disconnect} className="px-2 py-1 text-xs text-blue-800 hover:underline">
        Cancel (don&apos;t connect)
      </button>
    </div>
  );
}

function formatModified(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
