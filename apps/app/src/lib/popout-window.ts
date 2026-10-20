export const POPOUT_WINDOW_QUERY_PARAM = "bbWindow";
export const POPOUT_WINDOW_QUERY_VALUE = "popout";
export const POPOUT_WINDOW_SESSION_KEY = "bb.window.popout";

let cachedIsPopoutWindow: boolean | null = null;

export function withPopoutWindowQueryParam(routePath: string): string {
  const url = new URL(routePath, "http://bb.invalid");
  url.searchParams.set(POPOUT_WINDOW_QUERY_PARAM, POPOUT_WINDOW_QUERY_VALUE);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readPopoutWindowFlag(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (
    url.searchParams.get(POPOUT_WINDOW_QUERY_PARAM) ===
    POPOUT_WINDOW_QUERY_VALUE
  ) {
    url.searchParams.delete(POPOUT_WINDOW_QUERY_PARAM);
    try {
      window.sessionStorage.setItem(POPOUT_WINDOW_SESSION_KEY, "true");
    } catch {
      return true;
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    return true;
  }
  try {
    return window.sessionStorage.getItem(POPOUT_WINDOW_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

export function isPopoutWindow(): boolean {
  cachedIsPopoutWindow ??= readPopoutWindowFlag();
  return cachedIsPopoutWindow;
}
