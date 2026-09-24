import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const MAX_CALENDAR_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
/** The whole fetch, start to finish. */
const TOTAL_TIMEOUT_MS = 15_000;

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedAddress(address: string, family: number) {
  if (family === 4) return isBlockedIpv4(address);

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return true;

  // Public IPv6 unicast space is currently 2000::/3. Rejecting everything else
  // also blocks loopback, unique-local, link-local, multicast and unspecified IPs.
  if (!normalized.startsWith("2") && !normalized.startsWith("3")) return true;
  return normalized.startsWith("2001:db8:");
}

function validateCalendarUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("Enter a complete HTTPS calendar URL.");
  }

  if (url.protocol !== "https:") {
    throw new SafeFetchError("For safety, calendar links must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("Calendar links cannot contain a username or password.");
  }
  if (url.port && url.port !== "443") {
    throw new SafeFetchError("Calendar links must use the standard HTTPS port.");
  }

  return url;
}

async function resolvePublicAddress(hostname: string) {
  const cleanHostname = hostname.replace(/^\[|\]$/g, "");
  const answers = await lookup(cleanHostname, { all: true, verbatim: true });

  if (!answers.length) {
    throw new SafeFetchError("The calendar server could not be found.");
  }
  if (answers.some((answer) => isBlockedAddress(answer.address, answer.family))) {
    throw new SafeFetchError("That calendar server address is not allowed.");
  }

  return answers[0];
}

/**
 * `work`, or a `SafeFetchError` once `deadline` (an epoch ms) has passed.
 *
 * `onTimeout` is how the caller stops the work itself — a socket left open after
 * the answer has been given up on is the resource this limit exists to free.
 */
export function withinDeadline<T>(
  work: Promise<T>,
  deadline: number,
  onTimeout?: () => void,
): Promise<T> {
  // The losing side of the race still settles later; that must not surface as
  // an unhandled rejection.
  work.catch(() => undefined);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new SafeFetchError("The calendar server took too long to respond."));
    }, Math.max(0, deadline - Date.now()));

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function download(
  url: URL,
  redirectsRemaining: number,
  deadline: number,
): Promise<string> {
  const resolved = await withinDeadline(resolvePublicAddress(url.hostname), deadline);
  const originalHostname = url.hostname.replace(/^\[|\]$/g, "");
  let active: ReturnType<typeof httpsRequest> | undefined;

  const transfer = new Promise<string>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: resolved.address,
        family: resolved.family,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: isIP(originalHostname) ? undefined : originalHostname,
        headers: {
          Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.2",
          Host: url.host,
          "User-Agent": "BetterHuskyCT/0.1 calendar importer",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          if (redirectsRemaining === 0) {
            fail(new SafeFetchError("The calendar link redirected too many times."));
            return;
          }

          let redirectUrl: URL;
          try {
            redirectUrl = validateCalendarUrl(new URL(location, url).toString());
          } catch (error) {
            fail(error instanceof Error ? error : new SafeFetchError("The calendar redirect was invalid."));
            return;
          }

          // The redirect spends the same budget, not a fresh one.
          download(redirectUrl, redirectsRemaining - 1, deadline).then(resolve, fail);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          fail(new SafeFetchError(`The calendar server returned an error (${status}).`));
          return;
        }

        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > MAX_CALENDAR_BYTES) {
          response.resume();
          fail(new SafeFetchError("That calendar file is larger than 2 MB."));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;

        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_CALENDAR_BYTES) {
            response.destroy();
            fail(new SafeFetchError("That calendar file is larger than 2 MB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        response.on("error", fail);
      },
    );

    // An idle limit: fires only after this long with no bytes at all. A server
    // that sends one byte every few seconds never trips it, which is what the
    // overall deadline below is for.
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new SafeFetchError("The calendar server took too long to respond."));
    });
    request.on("error", (error) => {
      fail(
        error instanceof SafeFetchError
          ? error
          : new SafeFetchError("The calendar could not be downloaded."),
      );
    });
    active = request;
    request.end();
  });

  return withinDeadline(transfer, deadline, () => active?.destroy());
}

export async function fetchCalendarText(rawUrl: string) {
  const url = validateCalendarUrl(rawUrl);
  // One budget for the whole fetch — DNS, every redirect and the body — so a
  // slow-drip server cannot hold the function open past it.
  const body = await download(url, MAX_REDIRECTS, Date.now() + TOTAL_TIMEOUT_MS);

  if (!/BEGIN:VCALENDAR/i.test(body) || !/END:VCALENDAR/i.test(body)) {
    throw new SafeFetchError(
      "That link did not return an ICS calendar. Check that you copied the calendar feed URL, not a web page.",
    );
  }

  return body;
}
