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
import AccountSettingsPage from "@/pages/account-settings-page";
import TutorialPage from "@/pages/tutorial-page";
import SharedAnalysisPage from "@/pages/shared-analysis-page";

function ServerStartingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="text-center space-y-4 p-8">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-lg font-medium">Server is starting up&hellip;</p>
        <p className="text-sm text-muted-foreground">This usually takes 10&ndash;30 seconds. Hang tight.</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, loading, serverError } = useAuth();
  
  if (loading) return <div className="flex min-h-screen items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (serverError) return <ServerStartingScreen />;
  if (!user) return <Redirect to="/auth" />;
  
  return <Component {...rest} />;
}

function Router() {
  const { user, loading, serverError } = useAuth();

  return (
    <Switch>
      <Route path="/auth">
        {loading ? null : serverError ? <ServerStartingScreen /> : user ? <Redirect to="/dashboard" /> : <AuthPage />}
      </Route>
      
      <Route path="/">
        {loading ? null : serverError ? <ServerStartingScreen /> : user ? <Redirect to="/dashboard" /> : <Redirect to="/auth" />}
      </Route>

      <Route path="/dashboard">
        <AppLayout>
          <ProtectedRoute component={DashboardPage} />
        </AppLayout>
      </Route>

      <Route path="/favorites">
        <AppLayout>
          <ProtectedRoute component={() => <DashboardPage initialFavoritesOnly />} />
        </AppLayout>
      </Route>

      <Route path="/archive">
        <AppLayout>
          <ProtectedRoute component={() => <DashboardPage initialActiveTab="archive" />} />
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

      <Route path="/settings">
        <AppLayout>
          <ProtectedRoute component={AccountSettingsPage} />
        </AppLayout>
      </Route>

      <Route path="/tutorial">
        <AppLayout>
          <ProtectedRoute component={TutorialPage} />
        </AppLayout>
      </Route>

      <Route path="/share/:token">
        <SharedAnalysisPage />
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
