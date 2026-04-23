const API_BASE = "";

type JsonRequestInit = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  headers?: HeadersInit;
};

function buildApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function mergeHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers);
}

// --- 401 → refresh → retry interceptor ---------------------------------
//
// The backend issues a short-lived access cookie (30 min) and a long-lived
// refresh cookie (30 days, Path=/api/token). When the access cookie has
// expired any API call returns 401; the interceptor below catches that,
// serializes a single call to /api/token/refresh, and retries the
// original request. See doc/auth-refresh.md for the full flow.
//
// The install is a module-level side effect: any page that pulls anything
// from ./api/* gets the interceptor automatically. Login/register/index
// pages don't import these, so they keep their plain fetch behaviour.

const REFRESH_PATH = "/api/token/refresh";

// Don't try to refresh for these paths — they define the auth boundary
// themselves. Attempting to refresh a failed /login would loop.
const AUTH_EXEMPT_PATHS = new Set([
  REFRESH_PATH,
  "/api/login",
  "/api/register",
  "/api/logout",
]);

function shouldSkipRefresh(input: RequestInfo | URL): boolean {
  let url = "";
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.pathname;
  } else if (input instanceof Request) {
    url = input.url;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    return AUTH_EXEMPT_PATHS.has(parsed.pathname);
  } catch {
    return false;
  }
}

let refreshInFlight: Promise<boolean> | null = null;
let installed = false;

function runRefresh(originalFetch: typeof window.fetch): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    try {
      const res = await originalFetch(buildApiUrl(REFRESH_PATH), {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Release the lock on the next tick so concurrent 401 callers
      // observing the same in-flight promise resolve before we let a
      // brand-new refresh start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

function installAuthInterceptor(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const firstResponse = await originalFetch(input, init);
    if (firstResponse.status !== 401 || shouldSkipRefresh(input)) {
      return firstResponse;
    }

    const refreshed = await runRefresh(originalFetch);
    if (!refreshed) {
      // Refresh itself failed — fall through to the original 401. The
      // caller (or the page's top-level load) will route to /login.html.
      return firstResponse;
    }

    // Replay the original request once. Non-retryable bodies (already
    // consumed streams) will surface as a TypeError, which the caller
    // will handle the same way any network error does.
    return originalFetch(input, init);
  };
}

installAuthInterceptor();

// --- public helpers ----------------------------------------------------

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = mergeHeaders(init.headers);
  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
}

export async function requestJson<T>(path: string, init: JsonRequestInit = {}): Promise<{
  response: Response;
  data: T;
}> {
  const headers = mergeHeaders(init.headers);
  let body = init.body as BodyInit | null | undefined;
  if (
    init.body !== undefined &&
    init.body !== null &&
    !(init.body instanceof FormData) &&
    !(init.body instanceof Blob) &&
    !(init.body instanceof URLSearchParams) &&
    !(init.body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(init.body) &&
    !(typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream)
  ) {
    body = JSON.stringify(init.body);
  }

  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await request(path, {
    ...init,
    headers,
    body,
  });
  const data = (await response.json()) as T;
  return { response, data };
}

export { buildApiUrl };
