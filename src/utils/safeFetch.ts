import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";

/**
 * SSRF-hardened fetch for admin-supplied URLs (e.g. CSV image links).
 *
 * Guards:
 *  - http/https only (no file:, ftp:, data:, etc.)
 *  - every hostname is DNS-resolved and each resolved IP checked against a
 *    blocklist of private / loopback / link-local / reserved ranges
 *  - redirects are followed manually so each hop is re-validated (a public
 *    URL cannot 302 into the internal network)
 *  - request timeout
 *
 * Note: a determined attacker can still race DNS (rebind between our lookup
 * and the kernel's connect). For full protection the resolved IP must be
 * pinned to the socket; this guard covers the common cases without a custom
 * agent. Revisit if untrusted (non-admin) input ever reaches here.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

const blocked = new BlockList();
// IPv4
blocked.addSubnet("0.0.0.0", 8); // "this" network
blocked.addSubnet("10.0.0.0", 8); // private
blocked.addSubnet("100.64.0.0", 10); // CGNAT
blocked.addSubnet("127.0.0.0", 8); // loopback
blocked.addSubnet("169.254.0.0", 16); // link-local (incl. cloud metadata 169.254.169.254)
blocked.addSubnet("172.16.0.0", 12); // private
blocked.addSubnet("192.0.0.0", 24); // IETF protocol assignments
blocked.addSubnet("192.168.0.0", 16); // private
blocked.addSubnet("198.18.0.0", 15); // benchmarking
blocked.addSubnet("224.0.0.0", 4); // multicast
blocked.addSubnet("240.0.0.0", 4); // reserved
// IPv6
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local

function ipAllowed(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  // Node's BlockList maps IPv4 into IPv4-mapped IPv6 when matching, so a
  // blanket `::ffff:0:0/96` block would reject EVERY IPv4 address. Instead,
  // decode an IPv4-mapped IPv6 (e.g. `::ffff:169.254.169.254`) to its embedded
  // IPv4 and run it through the IPv4 ranges so the private blocks still bite.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mapped) return !blocked.check(mapped[1], "ipv4");
  return !blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

async function assertHostAllowed(hostname: string): Promise<void> {
  // Literal IP in the URL — check directly.
  if (isIP(hostname) !== 0) {
    if (!ipAllowed(hostname)) {
      throw new Error(`blocked address: ${hostname}`);
    }
    return;
  }
  const records = await lookup(hostname, { all: true });
  if (records.length === 0) throw new Error(`could not resolve ${hostname}`);
  for (const r of records) {
    if (!ipAllowed(r.address)) {
      throw new Error(`blocked address for ${hostname}: ${r.address}`);
    }
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
}

/** Fetch a public URL with SSRF guards + redirect re-validation. Throws on violation. */
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error(`invalid URL: ${current}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`unsupported protocol: ${parsed.protocol}`);
    }
    await assertHostAllowed(parsed.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Manual redirect handling so each hop is re-validated.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}
