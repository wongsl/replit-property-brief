import { useState } from "react";
import { useAuth } from "@/lib/mock-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Lock, Database, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AuthPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");

  const handleLogin = async () => {
    const ok = await login(username, password);
    if (ok) setLocation("/dashboard");
  };

  const handleRegister = async () => {
    const ok = await register(username, password, email, "user");
    if (ok) setLocation("/dashboard");
  };

  const handleForgotPassword = async () => {
    if (!resetIdentifier.trim()) {
      toast({ title: "Required", description: "Please enter your username or email.", variant: "destructive" });
      return;
    }
    const res = await fetch('/api/auth/request-password-reset/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: resetIdentifier }),
    });
    if (res.ok) {
      setResetSent(true);
    } else {
      toast({ title: "Something went wrong", description: "Please try again.", variant: "destructive" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (mode === "login") handleLogin();
      else if (mode === "register") handleRegister();
      else if (mode === "forgot") handleForgotPassword();
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
            <CardTitle>
              {mode === "login" ? "Welcome back" : mode === "register" ? "Create Account" : "Reset Password"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Sign in to your account."
                : mode === "register"
                ? "Create your account to get started."
                : "Enter your username or email and we'll send you a reset link."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "forgot" ? (
              resetSent ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  If that account exists, a reset link has been sent to the associated email. Check your inbox.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="reset-identifier">Username or Email</Label>
                    <Input
                      id="reset-identifier"
                      placeholder="Enter your username or email"
                      value={resetIdentifier}
                      onChange={(e) => setResetIdentifier(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="bg-muted/50"
                    />
                  </div>
                  <Button className="w-full" size="lg" onClick={handleForgotPassword}>
                    Send Reset Link
                  </Button>
                </>
              )
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    data-testid="input-username"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="bg-muted/50"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {mode === "login" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-primary underline"
                        onClick={() => { setMode("forgot"); setResetSent(false); setResetIdentifier(""); }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    data-testid="input-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="bg-muted/50"
                  />
                </div>

                {mode === "register" && (
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      data-testid="input-email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="bg-muted/50"
                    />
                  </div>
                )}

                {mode === "register" && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    <Gift className="h-3.5 w-3.5 shrink-0" />
                    You'll receive <strong>40 free credits</strong> to get started.
                  </div>
                )}

                {mode === "login" ? (
                  <Button className="w-full" size="lg" onClick={handleLogin} data-testid="button-login">
                    Sign In
                  </Button>
                ) : (
                  <Button className="w-full" size="lg" onClick={handleRegister} data-testid="button-register-user">
                    Create Account
                  </Button>
                )}
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t bg-muted/20 py-4">
            {mode === "forgot" ? (
              <button
                className="text-xs text-muted-foreground hover:text-primary underline"
                onClick={() => setMode("login")}
              >
                Back to sign in
              </button>
            ) : (
              <button
                className="text-xs text-muted-foreground hover:text-primary underline"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
                data-testid="button-toggle-mode"
              >
                {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
              </button>
            )}
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
