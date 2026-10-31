export const AUTH_TOKEN_KEY = "lindeploy_auth_token";
export const AUTH_USER_KEY = "lindeploy_auth_user";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_staff: boolean;
  is_superuser: boolean;
};

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(token: string, user: AuthUser) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  } catch {
    // Ignore
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // Ignore
  }
}

export function getAuthHeaders(): HeadersInit {
  const token = getStoredAuthToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
  return {};
}

let fetchInterceptorInstalled = false;

export function installGlobalFetchAuthInterceptor(onUnauthorized?: () => void) {
  if (fetchInterceptorInstalled || typeof window === "undefined") {
    return;
  }

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    let [input, init] = args;
    const token = getStoredAuthToken();

    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const isApiRequest = url.includes("/api/") && !url.includes("/api/auth/login") && !url.includes("/api/auth/google") && !url.includes("/api/auth/register");

    if (token && isApiRequest) {
      init = init || {};
      const headers = new Headers(init.headers || {});
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      init.headers = headers;
    }

    const response = await originalFetch(input, init);

    if (response.status === 401 && isApiRequest) {
      clearStoredAuth();
      if (onUnauthorized) {
        onUnauthorized();
      }
    }

    return response;
  };

  fetchInterceptorInstalled = true;
}
