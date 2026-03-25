import React, { createContext, useContext, useState, useEffect } from "react";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";

type UserRole = "admin" | "team_leader" | "user" | "viewer";

interface User {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  team: number | null;
  team_name: string | null;
  credits: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  serverError: boolean;
  logout: () => void;
  refreshUser: () => Promise<void>;
  rateLimitRemaining: number;
  decrementRateLimit: () => boolean;
  resetRateLimit: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const MAX_REQUESTS = 20;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const { getToken, signOut } = useClerkAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(MAX_REQUESTS);
  const { toast } = useToast();

  useEffect(() => {
    if (!clerkLoaded) return;

    if (!clerkUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Get a Clerk JWT and sync with the Django backend to establish a session.
    (async () => {
      setLoading(true);
      setServerError(false);
      try {
        const token = await getToken();
        const res = await fetch('/api/auth/sync/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            clerk_id: clerkUser.id,
            email: clerkUser.primaryEmailAddress?.emailAddress,
            username: clerkUser.username || clerkUser.primaryEmailAddress?.emailAddress?.split('@')[0],
          }),
        });
        if (res.ok) {
          setUser(await res.json());
          setServerError(false);
        } else if (res.status >= 500 || res.status === 504) {
          // Backend is down or starting up — don't redirect, retry after a delay
          setServerError(true);
          setTimeout(() => setRetryCount(c => c + 1), 4000);
        }
      } catch {
        // Network error — backend unreachable
        setServerError(true);
        setTimeout(() => setRetryCount(c => c + 1), 4000);
      } finally {
        setLoading(false);
      }
    })();
  }, [clerkUser?.id, clerkLoaded, retryCount]);

  const logout = () => {
    signOut();
    fetch('/api/auth/logout/', { method: 'POST', credentials: 'include' });
    setUser(null);
    setRateLimitRemaining(MAX_REQUESTS);
    toast({ title: "Logged out", description: "See you next time." });
  };

  const refreshUser = async () => {
    const res = await fetch('/api/auth/me/', { credentials: 'include' });
    if (res.ok) setUser(await res.json());
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
    <AuthContext.Provider value={{ user, loading, serverError, logout, refreshUser, rateLimitRemaining, decrementRateLimit, resetRateLimit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
