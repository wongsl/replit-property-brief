import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Users, Activity, ShieldAlert, Settings, MoreVertical, Trash2, UserCog,
  CheckCircle, XCircle, ShieldCheck, Coins, Plus, Minus, Files, ChevronDown, ChevronRight
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type AdminDoc = {
  id: number;
  name: string;
  file_type: string;
  file_size: string;
  status: string;
  created_at: string;
  owner_id: number;
  owner_name: string;
  team_id: number | null;
  team_name: string | null;
  folder_name: string | null;
  analyzed: boolean;
};

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
  const [teams, setTeams] = useState<any[]>([]);
  const [adminApplications, setAdminApplications] = useState<any[]>([]);
  const [creditRequests, setCreditRequests] = useState<any[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [grantTarget, setGrantTarget] = useState<any>(null);
  const [grantAmount, setGrantAmount] = useState("5");
  const [isGranting, setIsGranting] = useState(false);
  const [allDocuments, setAllDocuments] = useState<AdminDoc[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [collapsedUsers, setCollapsedUsers] = useState<Set<string>>(new Set());

  const loadAllDocuments = async () => {
    setDocsLoading(true);
    const res = await apiFetch('/api/admin/documents/');
    if (res.ok) setAllDocuments(await res.json());
    setDocsLoading(false);
  };

  // Group documents: { teamName -> { userName -> AdminDoc[] } }
  const groupedDocs = useMemo(() => {
    if (!allDocuments) return null;
    const byTeam: Record<string, Record<string, AdminDoc[]>> = {};
    for (const doc of allDocuments) {
      const team = doc.team_name ?? "No Team";
      const user = doc.owner_name;
      if (!byTeam[team]) byTeam[team] = {};
      if (!byTeam[team][user]) byTeam[team][user] = [];
      byTeam[team][user].push(doc);
    }
    return byTeam;
  }, [allDocuments]);

  const toggleTeam = (team: string) => {
    setCollapsedTeams(prev => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team); else next.add(team);
      return next;
    });
  };

  const toggleUser = (key: string) => {
    setCollapsedUsers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const loadUsers = () => {
    apiFetch('/api/admin/users/').then(async (res) => {
      if (res.ok) setUsers(await res.json());
    });
  };

  const loadApplications = () => {
    apiFetch('/api/admin/applications/').then(async (res) => {
      if (res.ok) setAdminApplications(await res.json());
    });
  };

  const loadCreditRequests = () => {
    apiFetch('/api/admin/credit-requests/').then(async (res) => {
      if (res.ok) setCreditRequests(await res.json());
    });
  };

  useEffect(() => {
    loadUsers();
    loadApplications();
    loadCreditRequests();
    apiFetch('/api/teams/').then(async (res) => {
      if (res.ok) setTeams(await res.json());
    });
  }, []);

  const handleResolveApplication = async (appId: number, action: 'approve' | 'reject') => {
    const res = await apiFetch(`/api/admin/applications/${appId}/resolve/`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setAdminApplications(prev => prev.filter(a => a.id !== appId));
      if (action === 'approve') loadUsers();
    }
  };

  const handleResolveCreditRequest = async (reqId: number, action: 'approve' | 'reject') => {
    const res = await apiFetch(`/api/admin/credit-requests/${reqId}/resolve/`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setCreditRequests(prev => prev.filter(r => r.id !== reqId));
      if (action === 'approve') loadUsers();
    }
  };

  const handleGrantCredits = async () => {
    if (!grantTarget) return;
    const amount = parseInt(grantAmount);
    if (isNaN(amount) || amount < 1) return;
    setIsGranting(true);
    const res = await apiFetch(`/api/admin/users/${grantTarget.id}/grant-credits/`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(prev => prev.map(u => u.id === grantTarget.id ? { ...u, credits: data.credits } : u));
      setGrantTarget(null);
      setGrantAmount("5");
    }
    setIsGranting(false);
  };

  if (user?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  const handleRoleChange = async (userId: number, role: string) => {
    const res = await apiFetch(`/api/admin/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: updated.role } : u));
    }
  };

  const handleTeamChange = async (userId: number, teamId: number | null) => {
    const res = await apiFetch(`/api/admin/users/${userId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ team_id: teamId }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, team: updated.team, team_name: updated.team_name } : u));
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

  const roleLabel = (role: string) => {
    if (role === 'team_leader') return 'Team Leader';
    return role.charAt(0).toUpperCase() + role.slice(1);
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

      {adminApplications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Admin Applications
              <Badge className="ml-1 h-5 px-1.5 text-xs">{adminApplications.length}</Badge>
            </CardTitle>
            <CardDescription>Users requesting admin privileges.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminApplications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">{app.username}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{app.email || <span className="italic">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(app.requested_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="default" onClick={() => handleResolveApplication(app.id, 'approve')}>
                          <CheckCircle className="mr-1 h-3.5 w-3.5" />Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleResolveApplication(app.id, 'reject')}>
                          <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {creditRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Credit Requests
              <Badge className="ml-1 h-5 px-1.5 text-xs">{creditRequests.length}</Badge>
            </CardTitle>
            <CardDescription>Users requesting additional analysis credits.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditRequests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">{req.username}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline"><Coins className="mr-1 h-3 w-3" />{req.amount}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(req.requested_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="default" onClick={() => handleResolveCreditRequest(req.id, 'approve')}>
                          <CheckCircle className="mr-1 h-3.5 w-3.5" />Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleResolveCreditRequest(req.id, 'reject')}>
                          <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>Manage roles, teams, permissions, and credits for all registered users.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Analyzed</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{u.email || <span className="italic">—</span>}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{roleLabel(u.role)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.team_name || "No team"}</TableCell>
                  <TableCell className="text-right font-medium">{u.document_count ?? 0}</TableCell>
                  <TableCell className="text-right font-medium">{u.analyzed_count ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <span className={`text-sm font-medium ${(u.credits ?? 0) === 0 ? 'text-destructive' : (u.credits ?? 0) <= 2 ? 'text-orange-500' : ''}`}>
                      {u.credits ?? 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`button-actions-${u.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Change Role</DropdownMenuLabel>
                        {u.role !== 'admin' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'admin')}>Promote to Admin</DropdownMenuItem>
                        )}
                        {u.role !== 'team_leader' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'team_leader')}>
                            <UserCog className="mr-2 h-4 w-4" />Set as Team Leader
                          </DropdownMenuItem>
                        )}
                        {u.role !== 'user' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'user')}>Set as User</DropdownMenuItem>
                        )}
                        {u.role !== 'viewer' && (
                          <DropdownMenuItem onClick={() => handleRoleChange(u.id, 'viewer')}>Set as Viewer</DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />

                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Users className="mr-2 h-4 w-4" />Change Team
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {u.team !== null && (
                              <DropdownMenuItem onClick={() => handleTeamChange(u.id, null)}>
                                Remove from team
                              </DropdownMenuItem>
                            )}
                            {teams.filter(t => t.id !== u.team).map((t) => (
                              <DropdownMenuItem key={t.id} onClick={() => handleTeamChange(u.id, t.id)}>
                                {t.name}
                              </DropdownMenuItem>
                            ))}
                            {teams.length === 0 && (
                              <DropdownMenuItem disabled>No teams available</DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem onClick={() => { setGrantTarget(u); setGrantAmount("5"); }}>
                          <Coins className="mr-2 h-4 w-4" />Grant Credits
                        </DropdownMenuItem>

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
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team File Stats</CardTitle>
          <CardDescription>Number of files accessible to each team.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Team Files</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right">{t.member_count ?? 0}</TableCell>
                  <TableCell className="text-right font-medium">{t.document_count ?? 0}</TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No teams found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Files className="h-5 w-5" />
                All Files
              </CardTitle>
              <CardDescription>Every file across all users, grouped by team and user.</CardDescription>
            </div>
            {allDocuments === null ? (
              <Button variant="outline" size="sm" onClick={loadAllDocuments} disabled={docsLoading}>
                {docsLoading ? "Loading..." : "Load Files"}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">{allDocuments.length} file{allDocuments.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </CardHeader>
        {groupedDocs && (
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Folder</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Analyzed</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(groupedDocs).sort((a, b) => {
                  if (a === "No Team") return 1;
                  if (b === "No Team") return -1;
                  return a.localeCompare(b);
                }).map((teamName) => {
                  const teamCollapsed = collapsedTeams.has(teamName);
                  const userMap = groupedDocs[teamName];
                  const teamTotal = Object.values(userMap).reduce((n, docs) => n + docs.length, 0);
                  return (
                    <React.Fragment key={`team-${teamName}`}>
                      <TableRow
                        className="bg-muted/60 cursor-pointer hover:bg-muted/80"
                        onClick={() => toggleTeam(teamName)}
                      >
                        <TableCell colSpan={6} className="py-2 font-semibold">
                          <span className="inline-flex items-center gap-2">
                            {teamCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <Users className="h-4 w-4" />
                            {teamName}
                            <span className="font-normal text-muted-foreground text-xs ml-1">{teamTotal} file{teamTotal !== 1 ? 's' : ''}</span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {!teamCollapsed && Object.keys(userMap).sort((a, b) => a.localeCompare(b)).map((userName) => {
                        const userKey = `${teamName}::${userName}`;
                        const userCollapsed = collapsedUsers.has(userKey);
                        const docs = userMap[userName];
                        return (
                          <React.Fragment key={`user-${userKey}`}>
                            <TableRow
                              className="bg-muted/20 cursor-pointer hover:bg-muted/40"
                              onClick={() => toggleUser(userKey)}
                            >
                              <TableCell colSpan={6} className="py-1.5 pl-10 text-sm">
                                <span className="inline-flex items-center gap-2 text-muted-foreground">
                                  {userCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  @{userName}
                                  <span className="text-xs">{docs.length} file{docs.length !== 1 ? 's' : ''}</span>
                                </span>
                              </TableCell>
                            </TableRow>
                            {!userCollapsed && docs.map((doc) => (
                              <TableRow key={doc.id} className="hover:bg-muted/10">
                                <TableCell className="pl-16 text-sm">{doc.name}</TableCell>
                                <TableCell className="text-muted-foreground text-sm">{doc.folder_name ?? <span className="italic">—</span>}</TableCell>
                                <TableCell><Badge variant="outline" className="text-xs uppercase">{doc.file_type}</Badge></TableCell>
                                <TableCell className="text-muted-foreground text-sm">{doc.file_size}</TableCell>
                                <TableCell>
                                  {doc.analyzed
                                    ? <CheckCircle className="h-4 w-4 text-green-500" />
                                    : <span className="text-muted-foreground text-xs">—</span>}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {new Date(doc.created_at).toLocaleDateString()}
                                </TableCell>
                              </TableRow>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                {allDocuments?.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No files found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {/* Grant Credits Dialog */}
      <Dialog open={!!grantTarget} onOpenChange={(open) => !open && setGrantTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Grant Credits — {grantTarget?.username}</DialogTitle>
            <DialogDescription>
              Current balance: <strong>{grantTarget?.credits ?? 0}</strong> credits. Enter the number of credits to add.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Label htmlFor="grant-amount">Credits to add</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setGrantAmount(a => String(Math.max(1, parseInt(a || '1') - 1)))}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                id="grant-amount"
                type="number"
                min={1}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="text-center"
              />
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setGrantAmount(a => String(parseInt(a || '0') + 1))}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantTarget(null)} disabled={isGranting}>Cancel</Button>
            <Button onClick={handleGrantCredits} disabled={isGranting || !grantAmount || parseInt(grantAmount) < 1}>
              <Coins className="mr-2 h-4 w-4" />
              {isGranting ? "Granting..." : `Grant ${grantAmount} Credits`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
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
