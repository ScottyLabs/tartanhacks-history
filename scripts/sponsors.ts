import { readdir } from "node:fs/promises";

// Sponsor names, HTML markers, and the local image folders. The Drive sync
// imports this module; `--local` rebuilds the page from these folders and
// does not call Google.

export const MAX_BYTES = 1_000_000;
const MARKER_START = "<!-- sponsors:start -->";
const MARKER_END = "<!-- sponsors:end -->";
export const IMAGE_PREFIX = "2027/imgs/sponsors/";
export const PAGE_PATH = "2027/index.html";

export const TIERS = [
  { folder: "Title", heading: "Title sponsor", className: "tier tier--title" },
  { folder: "Premier", heading: "Premier sponsors", className: "tier tier--premier" },
  { folder: "Partner", heading: "Partner sponsors", className: "tier tier--partner" },
] as const;

export type Sponsor = {
  alt: string;
  file: string;
  bytes: Uint8Array;
};

export type Tier = {
  folder: string;
  heading: string;
  className: string;
  sponsors: Sponsor[];
};

export function fail(message: string): never {
  throw new Error(message);
}

export function stemOf(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of [".png", ".webp", ".jpg", ".jpeg", ".svg"]) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
}

export function slugOf(stem: string): string {
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) fail(`Sponsor name ${stem} has no safe filename`);
  return slug;
}

export function altOf(stem: string): string {
  return stem.replaceAll("_", " ").trim();
}

export function claimSponsor(
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

const LOCAL_IMAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|webp|jpe?g|svg)$/;

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
        fail(`${tier.folder}/${entry.name} is not a png, webp, jpeg, or svg`);
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
