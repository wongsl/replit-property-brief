import { useAuth } from "@/lib/mock-auth";
import { useClerk } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound } from "lucide-react";

export default function AccountSettingsPage() {
  const { user } = useAuth();
  const { openUserProfile } = useClerk();

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
