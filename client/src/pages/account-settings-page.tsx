import { useEffect, useState } from "react";
import { useAuth } from "@/lib/mock-auth";
import { useFeatureFlags } from "@/lib/feature-flags";
import { useClerk } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Zap, Loader2 } from "lucide-react";

interface CreditPackage {
  id: string;
  credits: number;
  price_cents: number;
  label: string;
  description: string;
}

export default function AccountSettingsPage() {
  const { user, refreshUser } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const { openUserProfile } = useClerk();
  const { toast } = useToast();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  // Fetch available credit packages
  useEffect(() => {
    fetch('/api/credits/packages/', { credentials: 'include' })
      .then(r => r.json())
      .then(setPackages)
      .catch(() => {});
  }, []);

  // Handle Stripe redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (params.get('stripe_success') && sessionId) {
      window.history.replaceState({}, '', '/settings');
      // Verify the session with Stripe directly — more reliable than waiting for webhook
      fetch('/api/stripe/verify-session/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id: sessionId }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.status === 'fulfilled' || data.status === 'already_processed') {
            toast({ title: "Purchase successful!", description: "Credits have been added to your account." });
            refreshUser();
          } else {
            toast({ title: "Purchase pending", description: "Credits will appear shortly.", variant: "default" });
            setTimeout(() => refreshUser(), 2000);
          }
        })
        .catch(() => {
          toast({ title: "Purchase successful!", description: "Credits will appear shortly." });
          setTimeout(() => refreshUser(), 2000);
        });
    } else if (params.get('stripe_canceled')) {
      window.history.replaceState({}, '', '/settings');
      toast({ title: "Purchase canceled", description: "No charges were made.", variant: "destructive" });
    }
  }, []);

  const handleBuy = async (packageId: string) => {
    setPurchasing(packageId);
    try {
      const res = await fetch('/api/credits/checkout/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ package_id: packageId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Could not start checkout.", variant: "destructive" });
        return;
      }
      window.location.href = data.url;
    } catch {
      toast({ title: "Error", description: "Could not connect to server.", variant: "destructive" });
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account details.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Your account information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{user?.username}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium capitalize">{user?.role === 'team_leader' ? 'Team Leader' : user?.role}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Credits</span>
            <span className="font-medium">{user?.credits ?? 0}</span>
          </div>
        </CardContent>
      </Card>

      {isEnabled('buy_credits') && packages.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Buy Credits</CardTitle>
            </div>
            <CardDescription>Most documents cost 1 credit to analyze. Larger, text-rich documents may cost more.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {packages.map((pkg) => (
              <div key={pkg.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{pkg.label}</p>
                  <p className="text-xs text-muted-foreground">{pkg.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">${(pkg.price_cents / 100).toFixed(2)}</span>
                  <Button size="sm" disabled={purchasing === pkg.id} onClick={() => handleBuy(pkg.id)}>
                    {purchasing === pkg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Buy'}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Account Security</CardTitle>
          </div>
          <CardDescription>Manage your password, email, and connected accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => openUserProfile()}>
            Manage Password & Security
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
