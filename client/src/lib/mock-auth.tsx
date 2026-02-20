import React, { createContext, useContext, useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

type UserRole = "admin" | "user" | "viewer";

interface User {
  id: number;
  username: string;
  role: UserRole;
  team: number | null;
  team_name: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, role: UserRole, teamId?: number) => Promise<boolean>;
  logout: () => void;
  rateLimitRemaining: number;
  decrementRateLimit: () => boolean;
  resetRateLimit: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const MAX_REQUESTS = 5;

async function apiFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'include',
  });
  return res;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(MAX_REQUESTS);
  const { toast } = useToast();

  useEffect(() => {
    apiFetch('/api/auth/me/').then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    const res = await apiFetch('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      toast({ title: "Welcome back!", description: `Logged in as ${data.username} (${data.role})` });
      return true;
    } else {
      const err = await res.json();
      toast({ title: "Login failed", description: err.error || "Invalid credentials", variant: "destructive" });
      return false;
    }
  };

  const register = async (username: string, password: string, role: UserRole, teamId?: number): Promise<boolean> => {
    const res = await apiFetch('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify({ username, password, role, team_id: teamId }),
    });
    if (res.ok) {
      const data = await res.json();
      setUser(data);
      toast({ title: "Account created!", description: `Welcome, ${data.username}` });
      return true;
    } else {
      const err = await res.json();
      toast({ title: "Registration failed", description: err.error || "Something went wrong", variant: "destructive" });
      return false;
    }
  };

  const logout = () => {
    apiFetch('/api/auth/logout/', { method: 'POST' });
    setUser(null);
    setRateLimitRemaining(MAX_REQUESTS);
    toast({ title: "Logged out", description: "See you next time." });
  };

  const decrementRateLimit = (): boolean => {
    if (rateLimitRemaining > 0) {
      setRateLimitRemaining((prev) => prev - 1);
      return true;
    }
    toast({ title: "Rate limit exceeded", description: "Please wait before performing more actions.", variant: "destructive" });
    return false;
  };

  const resetRateLimit = () => {
    setRateLimitRemaining(MAX_REQUESTS);
    toast({ title: "Rate limit reset", description: "You can now perform actions again." });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, rateLimitRemaining, decrementRateLimit, resetRateLimit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
