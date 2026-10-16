/**
 * One-time upload links for MCP agents that have a filesystem (Claude Code
 * and the like). Instead of pushing megabytes of base64 through a tool call
 * — slow and expensive in tokens — the agent asks for a link and uploads the
 * file with `curl -F file=@photo.jpg <url>`.
 *
 * A link is bound to the user + connection that created it and to what the
 * file is for. It is single-use, expires after {@link UPLOAD_LINK_TTL_MS},
 * and lives in memory (like rate limits — single-instance deploy), so a
 * restart simply invalidates outstanding links.
 */
import { randomToken } from './oauth-store.js';

export const UPLOAD_LINK_TTL_MS = 15 * 60 * 1000;
const MAX_LINKS = 1000;

export type UploadLinkPurpose =
  | { kind: 'asset_photo'; code: string }
  | { kind: 'asset_document'; code: string }
  /** Just store it; the agent passes the returned path on (report_damage). */
  | { kind: 'damage_photo' };

export type UploadLink = {
  userId: string;
  scope: string;
  agentName: string;
  purpose: UploadLinkPurpose;
  expiresAt: number;
};

const links = new Map<string, UploadLink>();

function prune(now: number) {
  for (const [token, link] of links) if (link.expiresAt < now) links.delete(token);
  // Oldest first (insertion order) if someone mints links in a loop.
  while (links.size >= MAX_LINKS) links.delete(links.keys().next().value!);
}

export function createUploadLink(link: Omit<UploadLink, 'expiresAt'>): {
  token: string;
  expiresAt: Date;
} {
  const now = Date.now();
  prune(now);
  const token = randomToken(24);
  const expiresAt = now + UPLOAD_LINK_TTL_MS;
  links.set(token, { ...link, expiresAt });
  return { token, expiresAt: new Date(expiresAt) };
}

/** Returns the live link for `token`, or null (unknown, used or expired). */
export function getUploadLink(token: string): UploadLink | null {
  const link = links.get(token);
  if (!link) return null;
  if (link.expiresAt < Date.now()) {
    links.delete(token);
    return null;
  }
  return link;
}

/** Burns a link after a successful upload. */
export function consumeUploadLink(token: string): void {
  links.delete(token);
}

/** Test-only. */
export function _resetUploadLinks(): void {
  links.clear();
}
