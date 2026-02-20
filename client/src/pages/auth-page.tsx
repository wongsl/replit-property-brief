import { useState, useEffect } from "react";
import { useAuth } from "@/lib/mock-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lock, Database } from "lucide-react";

export default function AuthPage() {
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [teamId, setTeamId] = useState<number | null>(null);
  const [teams, setTeams] = useState<{id: number, name: string}[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    fetch("/api/teams/").then(r => r.json()).then(setTeams).catch(() => {});
  }, []);

  const handleLogin = async () => {
    const ok = await login(username, password);
    if (ok) setLocation("/dashboard");
  };

  const handleRegister = async (role: "admin" | "user") => {
    const ok = await register(username, password, role, teamId || undefined);
    if (ok) setLocation("/dashboard");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xl ring-4 ring-primary/10">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">DocVault</h1>
          <p className="text-muted-foreground">Secure document storage for teams.</p>
        </div>

        <Card className="border-none shadow-2xl">
          <CardHeader>
            <CardTitle>{mode === "login" ? "Welcome back" : "Create Account"}</CardTitle>
            <CardDescription>
              {mode === "login" ? "Sign in to your account." : "Choose a role and team to get started."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input 
                id="username" 
                data-testid="input-username"
                placeholder="Enter your username" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-muted/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password"
                data-testid="input-password"
                placeholder="Enter your password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-muted/50"
              />
            </div>

            {mode === "register" && (
              <>
                <div className="space-y-2">
                  <Label>Select Team</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {teams.map(t => (
                      <Button 
                        key={t.id} 
                        variant={teamId === t.id ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setTeamId(t.id)}
                        data-testid={`button-team-${t.id}`}
                      >
                        {t.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <Tabs defaultValue="user" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="user">User</TabsTrigger>
                    <TabsTrigger value="admin">Admin</TabsTrigger>
                  </TabsList>
                  <TabsContent value="user" className="mt-4 space-y-4">
                    <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-600 dark:text-blue-400">
                      <p className="font-medium">User Role:</p>
                      <ul className="mt-2 list-disc pl-4 space-y-1">
                        <li>View own documents</li>
                        <li>Upload new files</li>
                        <li>Limited rate limits</li>
                      </ul>
                    </div>
                    <Button className="w-full" size="lg" onClick={() => handleRegister("user")} data-testid="button-register-user">
                      Register as User
                    </Button>
                  </TabsContent>
                  <TabsContent value="admin" className="mt-4 space-y-4">
                    <div className="rounded-lg bg-purple-500/10 p-4 text-sm text-purple-600 dark:text-purple-400">
                      <p className="font-medium">Admin Role:</p>
                      <ul className="mt-2 list-disc pl-4 space-y-1">
                        <li>View ALL documents</li>
                        <li>Manage users</li>
                        <li>Higher rate limits</li>
                      </ul>
                    </div>
                    <Button className="w-full" size="lg" onClick={() => handleRegister("admin")} data-testid="button-register-admin">
                      Register as Admin
                    </Button>
                  </TabsContent>
                </Tabs>
              </>
            )}

            {mode === "login" && (
              <Button className="w-full" size="lg" onClick={handleLogin} data-testid="button-login">
                Sign In
              </Button>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t bg-muted/20 py-4">
            <button 
              className="text-xs text-muted-foreground hover:text-primary underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              data-testid="button-toggle-mode"
            >
              {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
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
