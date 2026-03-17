import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Database, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);

  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const handleReset = async () => {
    if (!token) {
      toast({ title: "Invalid link", description: "No reset token found.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    const res = await fetch('/api/auth/reset-password/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      setDone(true);
    } else {
      toast({ title: "Error", description: data.error ?? "Something went wrong.", variant: "destructive" });
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xl ring-4 ring-primary/10">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Property Brief</h1>
          <p className="text-muted-foreground">Secure document storage for teams.</p>
        </div>

        <Card className="border-none shadow-2xl">
          <CardHeader>
            <CardTitle>Set New Password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {done ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                Your password has been reset. You can now sign in.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    className="bg-muted/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    className="bg-muted/50"
                  />
                </div>
                <Button className="w-full" size="lg" onClick={handleReset}>
                  Reset Password
                </Button>
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t bg-muted/20 py-4">
            <button
              className="text-xs text-muted-foreground hover:text-primary underline"
              onClick={() => setLocation("/auth")}
            >
              {done ? "Go to sign in" : "Back to sign in"}
            </button>
            <div className="flex items-center text-xs text-muted-foreground">
              <Lock className="mr-1 h-3 w-3" />
              Secured by Django Auth
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
