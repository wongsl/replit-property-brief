import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/mock-auth";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
            <SidebarTrigger className="-ml-1" />
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
    <Sidebar>
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2 font-display font-bold text-xl">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Database className="h-4 w-4" />
          </div>
          Property Brief
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    tooltip={item.title}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto p-4">
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
