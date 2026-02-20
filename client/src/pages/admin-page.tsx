import { useState, useEffect } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Users, Activity, ShieldAlert, Settings, MoreVertical, Trash2
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

async function apiFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'include',
  });
}

export default function AdminPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadUsers = () => {
    apiFetch('/api/admin/users/').then(async (res) => {
      if (res.ok) setUsers(await res.json());
    });
  };

  useEffect(() => { loadUsers(); }, []);

  if (user?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  const handleRoleChange = async (userId: number, role: string) => {
    const res = await apiFetch(`/api/admin/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    }
  };

  const handleDeleteUser = async (keepFiles: boolean) => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const res = await apiFetch(`/api/admin/users/${deleteTarget.id}/delete/`, {
      method: 'DELETE',
      body: JSON.stringify({ keep_files: keepFiles }),
    });
    if (res.ok) {
      loadUsers();
    }
    setIsDeleting(false);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold tracking-tight">Admin Console</h2>
        <p className="text-muted-foreground">Manage users, permissions, and system health.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">{users.length}</div>
            <p className="text-xs text-muted-foreground">Registered accounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1</div>
            <p className="text-xs text-muted-foreground">Current session</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Alerts</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">System is secure</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Server Status</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">Online</div>
            <p className="text-xs text-muted-foreground">All systems operational</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>Manage roles and permissions for all registered users.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.team_name || "No team"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`button-actions-${u.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.role !== 'admin' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'admin')}>Promote to Admin</DropdownMenuItem>
                        )}
                        {u.role !== 'user' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'user')}>Set as User</DropdownMenuItem>
                        )}
                        {u.role !== 'viewer' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'viewer')}>Set as Viewer</DropdownMenuItem>
                        )}
                        {u.id !== user?.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(u)}
                              data-testid={`button-delete-${u.id}`}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />Delete User
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User: {deleteTarget?.username}</DialogTitle>
            <DialogDescription>
              This will permanently delete the user account. What would you like to do with their uploaded files?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <p className="text-sm text-muted-foreground">
              <strong>Keep files:</strong> Their documents will be moved to a folder named "{deleteTarget?.username}" under your account.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Delete files:</strong> All their documents will be permanently removed.
            </p>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => handleDeleteUser(true)} disabled={isDeleting} data-testid="button-keep-files">
              {isDeleting ? "Processing..." : "Keep Files & Delete User"}
            </Button>
            <Button variant="destructive" onClick={() => handleDeleteUser(false)} disabled={isDeleting} data-testid="button-delete-files">
              {isDeleting ? "Processing..." : "Delete Everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
