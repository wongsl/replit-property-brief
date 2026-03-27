import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/mock-auth";
import { usePrivacyMode } from "@/lib/privacy-mode";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Shield,
  LogOut,
  FileText,
  Users,
  Database,
  RefreshCw,
  Star,
  Settings,
  Archive,
  EyeOff,
  Eye,
  BookOpen,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Shared ref so the toggle button can clear the hover-expanded flag
const hoverExpandedRef = { current: false };

function SidebarToggleButton() {
  const { open, toggleSidebar } = useSidebar();
  return (
    <button
      onClick={() => { hoverExpandedRef.current = false; toggleSidebar(); }}
      className="-ml-1 flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
    >
      {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, rateLimitRemaining, resetRateLimit } = useAuth();
  const [location] = useLocation();

  if (!user) return <div className="min-h-screen w-full bg-background">{children}</div>;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur px-4">
            <SidebarToggleButton />
            <div className="mr-4 hidden md:flex">
              <span className="font-display font-bold text-lg tracking-tight">Property Brief</span>
            </div>
            <div className="ml-auto flex items-center gap-4">
               <div className="text-xs font-medium text-muted-foreground bg-secondary/50 px-3 py-1 rounded-full border border-border/50">
                  Rate Limit: <span className={cn(
                    rateLimitRemaining === 0 ? "text-destructive" : "text-primary"
                  )}>{rateLimitRemaining}</span> requests left
               </div>
               <Button variant="outline" size="sm" onClick={resetRateLimit} data-testid="button-reset-quota">
                 <RefreshCw className="mr-2 h-4 w-4" />Reset Quota
               </Button>
               <Avatar className="h-8 w-8">
                  <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
               </Avatar>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { privacyMode, togglePrivacyMode } = usePrivacyMode();
  const { open, setOpen } = useSidebar();
  const [showTutorialPrompt, setShowTutorialPrompt] = useState(false);
  const [creditRequestCount, setCreditRequestCount] = useState(0);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchCount = () => {
      fetch('/api/admin/credit-requests/', { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then((data: any[]) => setCreditRequestCount(Array.isArray(data) ? data.length : 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, [user?.role]);

  const handleMouseEnter = () => {
    if (!open) {
      hoverExpandedRef.current = true;
      setOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (hoverExpandedRef.current) {
      hoverExpandedRef.current = false;
      setOpen(false);
    }
  };

  useEffect(() => {
    const dismissed = sessionStorage.getItem('tutorial_prompt_dismissed');
    if (dismissed) return;
    fetch('/api/documents/?scope=team', { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((docs: any[]) => {
        if (docs.length === 0) setShowTutorialPrompt(true);
      })
      .catch(() => {});
  }, []);

  const menuItems = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      roles: ["admin", "team_leader", "user"],
    },
    {
      title: "Favorites",
      url: "/favorites",
      icon: Star,
      roles: ["admin", "team_leader", "user"],
    },
    {
      title: "File Explorer",
      url: "/explorer",
      icon: FileText,
      roles: ["admin", "team_leader", "user"],
    },
    {
      title: "Archive",
      url: "/archive",
      icon: Archive,
      roles: ["admin", "team_leader", "user"],
    },
    {
      title: "Teams",
      url: "/teams",
      icon: Users,
      roles: ["admin", "team_leader", "user"],
    },
    {
      title: "Admin Panel",
      url: "/admin",
      icon: Shield,
      roles: ["admin"],
    },
    {
      title: "Account Settings",
      url: "/settings",
      icon: Settings,
      roles: ["admin", "team_leader", "user", "viewer"],
    },
  ];

  const filteredItems = menuItems.filter((item) => item.roles.includes(user?.role || ""));

  return (
    <Sidebar collapsible="icon" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <SidebarHeader className="border-b !h-16 justify-center">
        <div className="flex items-center gap-2 font-display font-bold text-xl pl-2 group-data-[collapsible=icon]:pl-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Database className="h-4 w-4" />
          </div>
          <span className="overflow-hidden transition-all duration-200 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
            Property Brief
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => {
                const showBadge = item.title === "Admin Panel" && creditRequestCount > 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <div className="relative shrink-0">
                          <item.icon className="size-4 shrink-0" />
                          {showBadge && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white leading-none">
                              {creditRequestCount > 9 ? "9+" : creditRequestCount}
                            </span>
                          )}
                        </div>
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto p-4 group-data-[collapsible=icon]:hidden">
           <div className="rounded-xl border bg-card p-4 shadow-sm">
             <div className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Account</div>
             <div className="font-semibold text-sm capitalize">{user?.role === 'team_leader' ? 'Team Leader' : user?.role === 'admin' ? 'Admin' : 'Member'}</div>
             <div className="text-xs text-muted-foreground mt-1">
               {user?.team_name ? user.team_name : 'No team'}
             </div>
           </div>
        </div>
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={togglePrivacyMode} className={privacyMode ? "text-orange-500 hover:text-orange-500 hover:bg-orange-500/10" : ""}>
              {privacyMode ? <EyeOff /> : <Eye />}
              <span>{privacyMode ? "Privacy Mode On" : "Privacy Mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {showTutorialPrompt && (
            <div className="mb-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs relative">
              <button
                className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowTutorialPrompt(false);
                  sessionStorage.setItem('tutorial_prompt_dismissed', '1');
                }}
              >
                <X className="h-3 w-3" />
              </button>
              <p className="font-medium text-primary mb-0.5">New here?</p>
              <p className="text-muted-foreground leading-snug">Watch the tutorial to learn how to upload and analyze your first document.</p>
              <div className="mt-0 flex justify-center">
                <svg width="10" height="6" viewBox="0 0 10 6" className="text-primary/30 fill-primary/5 stroke-primary/30">
                  <path d="M0 0 L5 6 L10 0" strokeWidth="1" />
                </svg>
              </div>
            </div>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/tutorial" onClick={() => setShowTutorialPrompt(false)}>
                <BookOpen />
                <span>Tutorial</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} className="text-destructive hover:text-destructive hover:bg-destructive/10">
              <LogOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
