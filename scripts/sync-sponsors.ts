import { readdir } from "node:fs/promises";

// Syncs sponsor logos for the 2027 archive only. The branch is fixed so this
// job cannot update another year. `--local` rebuilds the sponsor section from
// the Title, Premier, and Partner folders in 2027/imgs/sponsors and does not
// call Google.

const REPO = "ScottyLabs/tartanhacks-history";
const BRANCH = "2027";
const YEAR_FOLDER = "26-27";
const TIER_IGNORE = new Set(["Special Partners"]);
const MAX_BYTES = 1_000_000;
const MARKER_START = "<!-- sponsors:start -->";
const MARKER_END = "<!-- sponsors:end -->";
const IMAGE_PREFIX = "2027/imgs/sponsors/";
const PAGE_PATH = "2027/index.html";

const TIERS = [
  { folder: "Title", heading: "Title sponsor", className: "tier tier--title" },
  { folder: "Premier", heading: "Premier sponsors", className: "tier tier--premier" },
  { folder: "Partner", heading: "Partner sponsors", className: "tier tier--partner" },
] as const;

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

type Sponsor = {
  alt: string;
  file: string;
  bytes: Uint8Array;
};

type Tier = {
  folder: string;
  heading: string;
  className: string;
  sponsors: Sponsor[];
};

type GitTreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
};

function fail(message: string): never {
  throw new Error(message);
}

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

function stemOf(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of [".png", ".webp", ".jpg", ".jpeg"]) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

function slugOf(stem: string): string {
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) fail(`Sponsor name ${stem} has no safe filename`);
  return slug;
}

function altOf(stem: string): string {
  return stem.replaceAll("_", " ").trim();
}

function claimSponsor(
  seenAlts: Map<string, string>,
  seenSlugs: Map<string, string>,
  tier: string,
  alt: string,
  slug: string,
  label: string,
): void {
  const previousTier = seenAlts.get(alt.toLowerCase());
  if (previousTier) fail(`${alt} appears in both ${previousTier} and ${tier}`);
  const previousFile = seenSlugs.get(slug);
  if (previousFile) fail(`${label} would overwrite ${previousFile}`);
  seenAlts.set(alt.toLowerCase(), tier);
  seenSlugs.set(slug, label);
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

export async function loadSponsors(): Promise<Tier[]> {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderSponsors(tiers: Tier[]): string {
  return tiers
    .filter((tier) => tier.sponsors.length > 0)
    .map((tier) => {
      const items = tier.sponsors
        .map(
          (sponsor) =>
            `          <li><img src="./imgs/sponsors/${sponsor.file}" alt="${escapeHtml(sponsor.alt)}"></li>`,
        )
        .join("\n");
      return [
        `      <div class="${tier.className}">`,
        `        <h3>${escapeHtml(tier.heading)}</h3>`,
        "        <ul>",
        items,
        "        </ul>",
        "      </div>",
      ].join("\n");
    })
    .join("\n");
}

function sponsorRegion(html: string): { start: number; end: number; inner: string } {
  const start = html.indexOf(MARKER_START);
  const end = html.indexOf(MARKER_END);
  if (start === -1 || end < start) fail("2027/index.html is missing sponsor markers");
  if (html.indexOf(MARKER_START, start + MARKER_START.length) !== -1) {
    fail("2027/index.html has repeated sponsor markers");
  }
  if (html.indexOf(MARKER_END, end + MARKER_END.length) !== -1) {
    fail("2027/index.html has repeated sponsor markers");
  }
  return { start, end, inner: html.slice(start + MARKER_START.length, end) };
}

export function spliceSponsors(html: string, inner: string): string {
  const region = sponsorRegion(html);
  const between = inner ? `\n${inner}\n      ` : "\n      ";
  return `${html.slice(0, region.start + MARKER_START.length)}${between}${html.slice(region.end)}`;
}

const LOCAL_IMAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|webp|jpe?g)$/;

async function readLocalImage(name: string): Promise<Uint8Array> {
  const path = `${IMAGE_PREFIX}${name}`;
  const file = Bun.file(path);
  if (!(await file.exists())) fail(`Missing ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length >= MAX_BYTES) {
    fail(`${name} must be a non-empty image under 1 MB`);
  }
  return bytes;
}

export async function loadLocalSponsors(): Promise<Tier[]> {
  const root = IMAGE_PREFIX.slice(0, -1);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => fail(`Missing ${root}`));
  const allowed = new Set<string>(TIERS.map((tier) => tier.folder));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (!allowed.has(entry.name)) fail(`Unexpected folder ${entry.name} in ${root}`);
      continue;
    }
    fail(`Unexpected file ${entry.name} in ${root}`);
  }

  const seenAlts = new Map<string, string>();
  const seenSlugs = new Map<string, string>();
  const tiers: Tier[] = [];
  for (const tier of TIERS) {
    const dir = `${IMAGE_PREFIX}${tier.folder}`;
    const files = await readdir(dir, { withFileTypes: true }).catch(() => fail(`Missing ${dir}`));
    const sponsors: Sponsor[] = [];
    for (const entry of files) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isFile()) fail(`Unexpected folder ${entry.name} in ${tier.folder}`);
      if (!LOCAL_IMAGE_NAME.test(entry.name)) {
        fail(`${tier.folder}/${entry.name} is not a png, webp, or jpeg`);
      }
      const alt = altOf(stemOf(entry.name));
      if (!alt) fail(`${entry.name} is missing a name`);
      claimSponsor(seenAlts, seenSlugs, tier.folder, alt, slugOf(stemOf(entry.name)), entry.name);
      sponsors.push({
        alt,
        file: `${tier.folder}/${entry.name}`,
        bytes: await readLocalImage(`${tier.folder}/${entry.name}`),
      });
    }
    sponsors.sort((a, b) => a.alt.localeCompare(b.alt, "en", { sensitivity: "base" }));
    tiers.push({ ...tier, sponsors });
  }
  if (tiers.every((tier) => tier.sponsors.length === 0)) fail("No local sponsor images");
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

function syncMode(): "drive" | "local" {
  const args = Bun.argv.slice(2);
  if (args.length === 0) return "drive";
  if (args.length === 1 && args[0] === "--local") return "local";
  fail(`Unknown arguments: ${args.join(" ")}`);
}

async function syncLocal(): Promise<void> {
  const pageFile = Bun.file(PAGE_PATH);
  if (!(await pageFile.exists())) fail(`${PAGE_PATH} is missing`);
  const html = await pageFile.text();
  const next = spliceSponsors(html, renderSponsors(await loadLocalSponsors()));
  if (next === html) {
    console.log("Sponsors unchanged");
    return;
  }
  await Bun.write(PAGE_PATH, next);
  console.log(`Updated ${PAGE_PATH}`);
}

async function main(): Promise<void> {
  if (syncMode() === "local") {
    await syncLocal();
    return;
  }
  await loadLocalEnv();
  const tiers = await loadSponsors();
  await publish(requiredEnv("SPONSORS_GITHUB_TOKEN"), tiers);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sponsor sync failed");
    process.exit(1);
  });
}
