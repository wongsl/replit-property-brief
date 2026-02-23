import { useState, useEffect } from "react";
import { useAuth } from "@/lib/mock-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users, LogOut, CheckCircle, XCircle, Clock, Plus, Settings, UserCog, UserMinus, Search, ShieldCheck } from "lucide-react";

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

export default function TeamsPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [teams, setTeams] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [myPendingRequests, setMyPendingRequests] = useState<any[]>([]);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [requestingTeamId, setRequestingTeamId] = useState<number | null>(null);
  const [teamSearch, setTeamSearch] = useState("");
  const [myAdminRequest, setMyAdminRequest] = useState<any | null>(undefined);

  // Member management dialog state
  const [manageTeam, setManageTeam] = useState<any | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const isLeaderOrAdmin = user?.role === 'admin' || user?.role === 'team_leader';

  const loadTeams = () => {
    apiFetch('/api/teams/').then(async (res) => {
      if (res.ok) setTeams(await res.json());
    });
  };

  const loadJoinRequests = () => {
    if (!isLeaderOrAdmin) return;
    apiFetch('/api/teams/join-requests/').then(async (res) => {
      if (res.ok) setJoinRequests(await res.json());
    });
  };

  const loadMyPendingRequests = () => {
    apiFetch('/api/teams/join-request/').then(async (res) => {
      if (res.ok) setMyPendingRequests(await res.json());
    });
  };

  const loadMyAdminRequest = () => {
    if (user?.role === 'admin') return;
    apiFetch('/api/admin/apply/').then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setMyAdminRequest(data.id ? data : null);
      }
    });
  };

  useEffect(() => {
    loadTeams();
    loadJoinRequests();
    loadMyPendingRequests();
    loadMyAdminRequest();
  }, [user?.role]);

  const openManageDialog = async (team: any) => {
    setManageTeam(team);
    setLoadingMembers(true);
    const res = await apiFetch(`/api/teams/${team.id}/members/`);
    if (res.ok) setMembers(await res.json());
    setLoadingMembers(false);
  };

  const handleCreateTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    setIsCreating(true);
    const res = await apiFetch('/api/teams/', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) {
      setTeams(prev => [...prev, data]);
      setNewTeamName('');
      setCreateDialogOpen(false);
      toast({ title: "Team created", description: `"${data.name}" is ready.` });
    } else {
      toast({ title: "Could not create team", description: data.error, variant: "destructive" });
    }
    setIsCreating(false);
  };

  // Admin: directly join a team without going through the request flow
  const handleAdminJoinTeam = async (teamId: number) => {
    const res = await apiFetch(`/api/admin/users/${user!.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ team_id: teamId }),
    });
    if (res.ok) {
      await refreshUser();
      loadTeams();
      toast({ title: "Joined team", description: "You have been added to the team." });
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  const handleJoinRequest = async (teamId: number) => {
    setRequestingTeamId(teamId);
    const res = await apiFetch('/api/teams/join-request/', {
      method: 'POST',
      body: JSON.stringify({ team_id: teamId }),
    });
    const data = await res.json();
    if (res.ok) {
      toast({ title: "Request sent", description: "Your join request has been submitted." });
      loadMyPendingRequests();
    } else {
      toast({ title: "Could not send request", description: data.error, variant: "destructive" });
    }
    setRequestingTeamId(null);
  };

  const handleCancelRequest = async (teamId: number) => {
    const res = await apiFetch('/api/teams/join-request/', {
      method: 'DELETE',
      body: JSON.stringify({ team_id: teamId }),
    });
    if (res.ok) {
      toast({ title: "Request cancelled", description: "Your join request has been withdrawn." });
      loadMyPendingRequests();
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  const handleLeaveTeam = async () => {
    const res = await apiFetch('/api/teams/leave/', { method: 'POST' });
    if (res.ok) {
      await refreshUser();
      loadTeams();
      toast({ title: "Left team", description: "You have left your team." });
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
    setLeaveDialogOpen(false);
  };

  const handleResolve = async (requestId: number, action: 'approve' | 'reject') => {
    const res = await apiFetch(`/api/teams/join-requests/${requestId}/resolve/`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      toast({
        title: action === 'approve' ? "Request approved" : "Request rejected",
        description: action === 'approve' ? "User has been added to the team." : "Join request rejected.",
      });
      setJoinRequests(prev => prev.filter(r => r.id !== requestId));
      if (action === 'approve') loadTeams();
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  // Member management: promote/demote/remove
  const handleMemberUpdate = async (memberId: number, patch: object) => {
    const res = await apiFetch(`/api/admin/users/${memberId}/`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setMembers(prev => prev.map(m => m.id === memberId ? updated : m)
        .filter(m => m.team === manageTeam?.id)); // remove if moved out
      loadTeams();
      toast({ title: "Updated", description: "Member updated successfully." });
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  const handleApplyAdmin = async () => {
    const res = await apiFetch('/api/admin/apply/', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setMyAdminRequest(data);
      toast({ title: "Application submitted", description: "An admin will review your request." });
    } else {
      toast({ title: "Could not apply", description: data.error, variant: "destructive" });
    }
  };

  const handleWithdrawAdminApp = async () => {
    const res = await apiFetch('/api/admin/apply/', { method: 'DELETE' });
    if (res.ok) {
      setMyAdminRequest(null);
      toast({ title: "Application withdrawn", description: "Your admin application has been cancelled." });
    } else {
      const data = await res.json();
      toast({ title: "Error", description: data.error, variant: "destructive" });
    }
  };

  const hasPendingRequest = (teamId: number) =>
    myPendingRequests.some(r => r.team === teamId && r.status === 'pending');

  const roleLabel = (role: string) =>
    role === 'team_leader' ? 'Team Leader' : role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">Teams</h2>
          <p className="text-muted-foreground">Manage team membership and join requests.</p>
        </div>
        {user?.role === 'admin' && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Team
          </Button>
        )}
      </div>

      {/* Current team status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Your Team
          </CardTitle>
          <CardDescription>
            {user?.team_name
              ? `You are currently a member of ${user.team_name}.`
              : "You are not currently a member of any team."}
          </CardDescription>
        </CardHeader>
        {user?.team_name && (
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="text-sm px-3 py-1">{user.team_name}</Badge>
              <Badge variant="outline">{roleLabel(user.role)}</Badge>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                onClick={() => setLeaveDialogOpen(true)}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Leave Team
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Pending join requests — team leaders & admins */}
      {isLeaderOrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending Join Requests
              {joinRequests.length > 0 && (
                <Badge className="ml-1 h-5 px-1.5 text-xs">{joinRequests.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {user?.role === 'admin'
                ? "All pending team join requests across all teams."
                : "Pending requests to join your team."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {joinRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No pending requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {joinRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.username}</TableCell>
                      <TableCell>{req.team_name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(req.requested_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="default" onClick={() => handleResolve(req.id, 'approve')}>
                            <CheckCircle className="mr-1 h-3.5 w-3.5" />Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleResolve(req.id, 'reject')}>
                            <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Apply for Admin — non-admins only */}
      {user?.role !== 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Admin Access
            </CardTitle>
            <CardDescription>
              Request admin privileges to manage users, teams, and system settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {myAdminRequest === undefined ? null : myAdminRequest === null ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">You do not currently have an admin application on file.</p>
                <Button variant="outline" onClick={handleApplyAdmin}>
                  <ShieldCheck className="mr-2 h-4 w-4" />Apply for Admin
                </Button>
              </div>
            ) : myAdminRequest.status === 'pending' ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">
                    <Clock className="mr-1 h-3 w-3" />Application Pending
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Submitted {new Date(myAdminRequest.requested_at).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleWithdrawAdminApp}
                >
                  Withdraw
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="destructive">Application Rejected</Badge>
                  <span className="text-sm text-muted-foreground">You may reapply at any time.</span>
                </div>
                <Button variant="outline" onClick={handleApplyAdmin}>
                  <ShieldCheck className="mr-2 h-4 w-4" />Reapply
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* All teams */}
      <Card>
        <CardHeader>
          <CardTitle>All Teams</CardTitle>
          <CardDescription>
            {user?.team
              ? "All teams in your organization."
              : "Request to join a team. A team leader must approve your request."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teams..."
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No teams yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No teams match "{teamSearch}"
                    </TableCell>
                  </TableRow>
                )}
                {teams.filter(t => t.name.toLowerCase().includes(teamSearch.toLowerCase())).map((team) => {
                  const isMember = user?.team === team.id;
                  const isPending = hasPendingRequest(team.id);
                  return (
                    <TableRow key={team.id}>
                      <TableCell className="font-medium">{team.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          <span className="text-sm">{team.member_count ?? 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isMember ? (
                            <Badge variant="secondary">Your Team</Badge>
                          ) : isPending ? (
                            <>
                              <Badge variant="outline">
                                <Clock className="mr-1 h-3 w-3" />Request Pending
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleCancelRequest(team.id)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : user?.role === 'admin' ? (
                            <Button size="sm" variant="outline" onClick={() => handleAdminJoinTeam(team.id)}>
                              Join Team
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={requestingTeamId === team.id || !!user?.team}
                              onClick={() => handleJoinRequest(team.id)}
                            >
                              Request to Join
                            </Button>
                          )}
                          {/* Manage button for admins and team leaders of this team */}
                          {(user?.role === 'admin' || (user?.role === 'team_leader' && user.team === team.id)) && (
                            <Button size="sm" variant="ghost" onClick={() => openManageDialog(team)}>
                              <Settings className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Manage members dialog */}
      <Dialog open={!!manageTeam} onOpenChange={(open) => { if (!open) { setManageTeam(null); setMembers([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage {manageTeam?.name}</DialogTitle>
            <DialogDescription>Promote members to team leader or remove them from the team.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {loadingMembers ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{m.username}</div>
                          {m.email && <div className="text-xs text-muted-foreground">{m.email}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{roleLabel(m.role)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <Settings className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {m.role !== 'team_leader' ? (
                              <DropdownMenuItem onClick={() => handleMemberUpdate(m.id, { role: 'team_leader' })}>
                                <UserCog className="mr-2 h-3.5 w-3.5" />Promote to Team Leader
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleMemberUpdate(m.id, { role: 'user' })}>
                                <UserCog className="mr-2 h-3.5 w-3.5" />Set as Member
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleMemberUpdate(m.id, { team_id: null })}
                            >
                              <UserMinus className="mr-2 h-3.5 w-3.5" />Remove from Team
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setManageTeam(null); setMembers([]); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create team dialog — admin only */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) setNewTeamName(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>Enter a unique name for the new team.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              className="mt-2"
              placeholder="e.g. West Coast Properties"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isCreating && handleCreateTeam()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={isCreating}>Cancel</Button>
            <Button onClick={handleCreateTeam} disabled={!newTeamName.trim() || isCreating}>
              {isCreating ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave team confirmation */}
      <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {user?.team_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will lose access to team files and will need to request to rejoin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleLeaveTeam}
            >
              Leave Team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
