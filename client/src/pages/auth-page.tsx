import { useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { Database } from "lucide-react";

export default function AuthPage() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xl ring-4 ring-primary/10">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Property Brief</h1>
          <p className="text-muted-foreground">Secure document storage for teams.</p>
        </div>

        <div className="flex justify-center">
          {mode === "sign-in" ? (
            <SignIn routing="virtual" forceRedirectUrl="/dashboard" />
          ) : (
            <SignUp routing="virtual" forceRedirectUrl="/dashboard" />
          )}
        </div>

        <div className="text-center">
          <button
            className="text-xs text-muted-foreground hover:text-primary underline"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
