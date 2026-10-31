import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  clearStoredAuth,
  getStoredAuthToken,
  getStoredAuthUser,
  installGlobalFetchAuthInterceptor,
  setStoredAuth,
  type AuthUser,
} from "../lib/authStorage";

type AuthContextType = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithGoogle: (credential: string) => Promise<{ success: boolean; error?: string }>;
  loginWithPassword: (usernameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string }>;
  registerWithPassword: (data: {
    email: string;
    password: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");

async function parseResponse(response: Response): Promise<{ ok: boolean; data: any; error?: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const json = await response.json();
      return { ok: response.ok, data: json, error: json.detail || json.message };
    } catch {
      // Fall through to text
    }
  }
  const text = await response.text().catch(() => "");
  return {
    ok: response.ok,
    data: null,
    error: response.ok ? undefined : `Server error (${response.status}): ${text.slice(0, 120)}`,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken());
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuthUser());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = () => {
    clearStoredAuth();
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    installGlobalFetchAuthInterceptor(() => {
      logout();
    });

    const existingToken = getStoredAuthToken();
    if (!existingToken) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    fetch(`${API_BASE}/api/auth/me/`, {
      headers: {
        Authorization: `Bearer ${existingToken}`,
      },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Session expired or invalid");
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted && data.user) {
          setUser(data.user);
          setStoredAuth(existingToken, data.user);
        }
      })
      .catch(() => {
        if (isMounted) {
          logout();
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loginWithGoogle = async (credential: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/google/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });

      const parsed = await parseResponse(response);
      if (!parsed.ok || !parsed.data) {
        return { success: false, error: parsed.error || "Google authentication failed." };
      }

      setStoredAuth(parsed.data.token, parsed.data.user);
      setToken(parsed.data.token);
      setUser(parsed.data.user);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to reach the backend server.";
      return { success: false, error: message };
    }
  };

  const loginWithPassword = async (usernameOrEmail: string, password: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameOrEmail, password }),
      });

      const parsed = await parseResponse(response);
      if (!parsed.ok || !parsed.data) {
        return { success: false, error: parsed.error || "Invalid email/username or password." };
      }

      setStoredAuth(parsed.data.token, parsed.data.user);
      setToken(parsed.data.token);
      setUser(parsed.data.user);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to reach the backend server.";
      return { success: false, error: message };
    }
  };

  const registerWithPassword = async (data: {
    email: string;
    password: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  }) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const parsed = await parseResponse(response);
      if (!parsed.ok || !parsed.data) {
        return { success: false, error: parsed.error || "Registration failed." };
      }

      setStoredAuth(parsed.data.token, parsed.data.user);
      setToken(parsed.data.token);
      setUser(parsed.data.user);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to reach the backend server.";
      return { success: false, error: message };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: Boolean(token && user),
        isLoading,
        loginWithGoogle,
        loginWithPassword,
        registerWithPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
