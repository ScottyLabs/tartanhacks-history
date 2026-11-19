import {
  altOf,
  claimSponsor,
  fail,
  IMAGE_PREFIX,
  MAX_BYTES,
  PAGE_PATH,
  renderSponsors,
  slugOf,
  spliceSponsors,
  stemOf,
  TIERS,
} from "./sync-local.ts";
import type { Sponsor, Tier } from "./sync-local.ts";

// Publishes sponsor logos for the 2027 archive from Google Drive. The branch
// is fixed so this job cannot update another year.

const REPO = "ScottyLabs/tartanhacks-history";
const BRANCH = "2027";
const YEAR_FOLDER = "26-27";
const TIER_IGNORE = new Set(["Special Partners"]);

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
};

type GitTreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
};

async function loadLocalEnv(): Promise<void> {
  const file = Bun.file(".env");
  if (!(await file.exists())) return;
  const text = await file.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key) || Bun.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    Bun.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) fail(`Missing ${name}`);
  return value;
}

function privateKey(): string {
  const value = requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!value.includes("BEGIN PRIVATE KEY")) fail("GOOGLE_PRIVATE_KEY is not a PEM private key");
  return value;
}

function driveFolderId(): string {
  const id = requiredEnv("DRIVE_FOLDER_ID");
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) fail("DRIVE_FOLDER_ID is not a Drive folder id");
  return id;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function signRs256(privateKeyPem: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function googleAccessToken(email: string, key: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = await signRs256(key, unsigned);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const json = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    fail(json.error_description ?? "Google authentication failed");
  }
  return json.access_token;
}

async function driveList(token: string, parentId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${parentId}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size)");
    url.searchParams.set("pageSize", "200");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = (await response.json()) as {
      error?: { message?: string };
      files?: DriveFile[];
      nextPageToken?: string;
    };
    if (!response.ok) fail(json.error?.message ?? "Drive list failed");
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

function oneFolder(entries: DriveFile[], name: string): DriveFile {
  const matches = entries.filter((entry) => entry.mimeType === FOLDER_MIME && entry.name === name);
  if (matches.length !== 1) fail(`Expected one Drive folder named ${name}`);
  return matches[0] ?? fail(`Expected one Drive folder named ${name}`);
}

async function downloadImage(token: string, file: DriveFile): Promise<Uint8Array> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) fail(`Could not download ${file.name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length >= MAX_BYTES) {
    fail(`${file.name} must be a non-empty image under 1 MB`);
  }
  return bytes;
}

async function loadSponsors(): Promise<Tier[]> {
  const token = await googleAccessToken(requiredEnv("GOOGLE_CLIENT_EMAIL"), privateKey());
  const parent = await driveList(token, driveFolderId());
  const year = oneFolder(parent, YEAR_FOLDER);
  const entries = await driveList(token, year.id);
  const allowed = new Set<string>(TIERS.map((tier) => tier.folder));
  for (const entry of entries) {
    if (entry.mimeType === FOLDER_MIME) {
      if (TIER_IGNORE.has(entry.name) || allowed.has(entry.name)) continue;
      fail(`Unexpected folder ${entry.name} in ${YEAR_FOLDER}`);
    }
    fail(`Unexpected file ${entry.name} in ${YEAR_FOLDER}`);
  }

  const seenAlts = new Map<string, string>();
  const seenSlugs = new Map<string, string>();
  const tiers: Tier[] = [];
  for (const tier of TIERS) {
    const folder = oneFolder(entries, tier.folder);
    const files = await driveList(token, folder.id);
    const sponsors: Sponsor[] = [];
    for (const file of files) {
      const ext = MIME_EXT[file.mimeType];
      if (!ext) fail(`${tier.folder}/${file.name} is not a png, webp, or jpeg`);
      if (Number(file.size ?? 0) >= MAX_BYTES) fail(`${file.name} must be under 1 MB`);
      const stem = stemOf(file.name);
      const alt = altOf(stem);
      const slug = slugOf(stem);
      claimSponsor(seenAlts, seenSlugs, tier.folder, alt, slug, file.name);
      const bytes = await downloadImage(token, file);
      sponsors.push({ alt, file: `${tier.folder}/${slug}${ext}`, bytes });
    }
    sponsors.sort((a, b) => a.alt.localeCompare(b.alt, "en", { sensitivity: "base" }));
    tiers.push({ ...tier, sponsors });
  }
  if (tiers.every((tier) => tier.sponsors.length === 0)) fail("Drive has no sponsors to publish");
  return tiers;
}

function gitBlobSha(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(`blob ${bytes.byteLength}\0`);
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function github<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "tartanhacks-sponsor-sync",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  let data: { message?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { message?: string };
    } catch {
      fail(`GitHub ${path} failed (${response.status})`);
    }
  }
  if (!response.ok || data === null) {
    fail(`GitHub ${path} failed (${response.status}): ${data?.message ?? response.statusText}`);
  }
  return data as T;
}

async function currentTree(token: string): Promise<{
  commitSha: string;
  treeSha: string;
  files: Map<string, string>;
  page: string;
}> {
  const ref = await github<{ object: { sha: string } }>(
    token,
    `/repos/${REPO}/git/ref/heads/${BRANCH}`,
  );
  const commit = await github<{ tree: { sha: string } }>(
    token,
    `/repos/${REPO}/git/commits/${ref.object.sha}`,
  );
  const tree = await github<{
    truncated?: boolean;
    tree: { path?: string; type?: string; sha?: string }[];
  }>(token, `/repos/${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) fail("Git tree is truncated");
  const files = new Map<string, string>();
  for (const entry of tree.tree) {
    if (entry.type === "blob" && entry.path && entry.sha) files.set(entry.path, entry.sha);
  }
  const pageSha = files.get(PAGE_PATH);
  if (!pageSha) fail("2027/index.html is not on the 2027 branch");
  const blob = await github<{ encoding: string; content: string }>(
    token,
    `/repos/${REPO}/git/blobs/${pageSha}`,
  );
  if (blob.encoding !== "base64") fail("Unexpected GitHub blob encoding");
  const page = Uint8Array.from(atob(blob.content.replaceAll("\n", "")), (char) =>
    char.charCodeAt(0),
  );
  if (gitBlobSha(page) !== pageSha) fail("Git blob hash does not match GitHub");
  return {
    commitSha: ref.object.sha,
    treeSha: commit.tree.sha,
    files,
    page: new TextDecoder().decode(page),
  };
}

async function createBlob(token: string, bytes: Uint8Array): Promise<string> {
  const blob = await github<{ sha: string }>(token, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: bytesToBase64(bytes), encoding: "base64" }),
  });
  return blob.sha;
}

async function publish(token: string, tiers: Tier[]): Promise<void> {
  const current = await currentTree(token);
  const page = new TextEncoder().encode(spliceSponsors(current.page, renderSponsors(tiers)));
  const desired = new Map<string, Uint8Array>([[PAGE_PATH, page]]);
  for (const tier of tiers) {
    for (const sponsor of tier.sponsors) {
      desired.set(`${IMAGE_PREFIX}${sponsor.file}`, sponsor.bytes);
    }
  }

  const updates: GitTreeEntry[] = [];
  for (const [path, bytes] of desired) {
    if (current.files.get(path) === gitBlobSha(bytes)) continue;
    updates.push({
      path,
      mode: "100644",
      type: "blob",
      sha: await createBlob(token, bytes),
    });
  }
  for (const path of current.files.keys()) {
    if (path.startsWith(IMAGE_PREFIX) && !desired.has(path)) {
      updates.push({ path, mode: "100644", type: "blob", sha: null });
    }
  }
  if (updates.length === 0) {
    console.log("Sponsors unchanged");
    return;
  }

  const tree = await github<{ sha: string }>(token, `/repos/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: current.treeSha, tree: updates }),
  });
  const commit = await github<{ sha: string }>(token, `/repos/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "chore: sync sponsor logos",
      tree: tree.sha,
      parents: [current.commitSha],
    }),
  });
  await github(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  console.log(`Updated ${BRANCH} to ${commit.sha}`);
}

export async function syncRemote(): Promise<void> {
  await loadLocalEnv();
  const tiers = await loadSponsors();
  await publish(requiredEnv("SPONSORS_GITHUB_TOKEN"), tiers);
}
