import { useEffect, useState } from "react";
import { useAuth } from "@/lib/mock-auth";
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
    if (params.get('stripe_success')) {
      window.history.replaceState({}, '', '/settings');
      toast({ title: "Purchase successful!", description: "Credits have been added to your account." });
      // Webhook and redirect race — refresh after a short delay to pick up the added credits
      setTimeout(() => refreshUser(), 1500);
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

      {/* Buy Credits card hidden — not yet launched */}

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
