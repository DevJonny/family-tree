"use client";

import type { DriveFileRef } from "./types";

/**
 * Thin client for the parts of the Google Drive REST API (v3) this app
 * needs, plus Google Identity Services (GIS) for OAuth.
 *
 * Scope: we deliberately request only `drive.file`, the least-privileged
 * Drive scope. It grants access solely to files/folders this app creates
 * (or that the user explicitly opens with it) — never the user's whole
 * Drive. The GEDCOM file lives in a normal, visible "Family Tree App"
 * folder in the user's Drive (not the hidden appDataFolder), so it's easy
 * for the user to find, back up, or open in another tool.
 *
 * SETUP REQUIRED (see ARCHITECTURE.md "Google Drive sync setup"):
 *   1. Create a Google Cloud project and enable the Drive API.
 *   2. Configure an OAuth consent screen and an OAuth 2.0 Client ID
 *      (Application type: Web application) with this app's origin(s)
 *      under "Authorized JavaScript origins".
 *   3. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.local to that client ID.
 * None of this can be done from inside the app/codebase — it requires the
 * account owner to act in the Google Cloud Console.
 */

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const APP_FOLDER_NAME = "Family Tree App";
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gisLoadPromise: Promise<void> | null = null;

function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Identity Services can only load in the browser"));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

export function getGoogleClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set. Google Drive sync requires a Google Cloud " +
        "OAuth client ID — see ARCHITECTURE.md for setup steps.",
    );
  }
  return clientId;
}

/**
 * Requests a short-lived Drive access token via the GIS token client
 * (implicit-style OAuth, no backend required). `prompt: ""` first attempts
 * a silent grant (works if the user already consented this session);
 * callers should retry with an interactive prompt if that fails.
 */
export async function requestAccessToken(options: { interactive: boolean }): Promise<string> {
  await loadGoogleIdentityServices();
  const clientId = getGoogleClientId();

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Google auth failed: ${response.error}`));
        } else {
          resolve(response.access_token);
        }
      },
    });
    client.requestAccessToken({ prompt: options.interactive ? "consent" : "" });
  });
}

async function driveFetch(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${path} failed: ${res.status} ${body}`);
  }
  return res;
}

/** Finds (or creates) the "Family Tree App" folder this app stores its GEDCOM file in. */
export async function ensureAppFolder(accessToken: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const listRes = await driveFetch(accessToken, `files?q=${q}&fields=files(id,name)`);
  const { files } = (await listRes.json()) as { files: { id: string; name: string }[] };
  if (files.length > 0) return files[0].id;

  const createRes = await driveFetch(accessToken, "files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function listGedcomFiles(accessToken: string, folderId: string): Promise<DriveFileRef[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    accessToken,
    `files?q=${q}&fields=files(id,name,modifiedTime,md5Checksum)`,
  );
  const { files } = (await res.json()) as {
    files: { id: string; name: string; modifiedTime: string; md5Checksum?: string }[];
  };
  return files.map((f) => ({ fileId: f.id, name: f.name, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum }));
}

export async function downloadFileContent(accessToken: string, fileId: string): Promise<string> {
  const res = await driveFetch(accessToken, `files/${fileId}?alt=media`);
  return res.text();
}

export async function createGedcomFile(
  accessToken: string,
  folderId: string,
  name: string,
  content: string,
): Promise<DriveFileRef> {
  const boundary = "family-tree-boundary";
  const metadata = { name, parents: [folderId], mimeType: "text/plain" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,md5Checksum",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  const f = (await res.json()) as { id: string; name: string; modifiedTime: string; md5Checksum?: string };
  return { fileId: f.id, name: f.name, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum };
}

export async function updateGedcomFile(
  accessToken: string,
  fileId: string,
  content: string,
): Promise<DriveFileRef> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,modifiedTime,md5Checksum`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "text/plain" },
      body: content,
    },
  );
  if (!res.ok) throw new Error(`Drive update failed: ${res.status} ${await res.text()}`);
  const f = (await res.json()) as { id: string; name: string; modifiedTime: string; md5Checksum?: string };
  return { fileId: f.id, name: f.name, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum };
}

export async function getFileMetadata(accessToken: string, fileId: string): Promise<DriveFileRef> {
  const res = await driveFetch(accessToken, `files/${fileId}?fields=id,name,modifiedTime,md5Checksum`);
  const f = (await res.json()) as { id: string; name: string; modifiedTime: string; md5Checksum?: string };
  return { fileId: f.id, name: f.name, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum };
}

// --- Minimal ambient typing for the GIS script we load at runtime. ---
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token: string; error?: string }) => void;
          }) => { requestAccessToken: (opts: { prompt: string }) => void };
        };
      };
    };
  }
}
