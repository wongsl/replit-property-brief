import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/lib/mock-auth";
import { AppLayout } from "@/components/nav-sidebar";
import AuthPage from "@/pages/auth-page";
import DashboardPage from "@/pages/dashboard-page";
import ExplorerPage from "@/pages/explorer-page";
import AdminPage from "@/pages/admin-page";
import TeamsPage from "@/pages/teams-page";

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, loading } = useAuth();
  
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (!user) return <Redirect to="/auth" />;
  
  return <Component {...rest} />;
}

function Router() {
  const { user, loading } = useAuth();

  return (
    <Switch>
      <Route path="/auth">
        {loading ? null : user ? <Redirect to="/dashboard" /> : <AuthPage />}
      </Route>
      
      <Route path="/">
        {loading ? null : user ? <Redirect to="/dashboard" /> : <Redirect to="/auth" />}
      </Route>

      <Route path="/dashboard">
        <AppLayout>
          <ProtectedRoute component={DashboardPage} />
        </AppLayout>
      </Route>

      <Route path="/explorer">
        <AppLayout>
          <ProtectedRoute component={ExplorerPage} />
        </AppLayout>
      </Route>

      <Route path="/admin">
        <AppLayout>
          <ProtectedRoute component={AdminPage} />
        </AppLayout>
      </Route>

      <Route path="/teams">
        <AppLayout>
          <ProtectedRoute component={TeamsPage} />
        </AppLayout>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
