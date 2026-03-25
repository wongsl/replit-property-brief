import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileText, FileImage, FileCode, FileIcon, Search, FolderOpen,
  ChevronRight, ChevronDown, Sparkles, Users, User, ArrowUpDown,
} from "lucide-react";

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

async function apiFetch(url: string) {
  return fetch(url, { credentials: 'include' });
}

export default function ExplorerPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'folder' | 'all'>('folder');
  const [adminDocuments, setAdminDocuments] = useState<AdminDoc[] | null>(null);
  const [adminDocsLoading, setAdminDocsLoading] = useState(false);
  const [collapsedUserGroups, setCollapsedUserGroups] = useState<Set<string>>(new Set());
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<number>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/documents/?scope=team'),
      apiFetch('/api/folders/'),
    ]).then(async ([docsRes, foldersRes]) => {
      if (docsRes.ok) setDocuments(await docsRes.json());
      if (foldersRes.ok) setFolders(await foldersRes.json());
    });
  }, []);

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key && prev.dir === 'asc'
        ? { key, dir: 'desc' }
        : { key, dir: 'asc' }
    );
  };

  const getSortValue = (doc: any, key: string) => {
    if (key.startsWith('ai_analysis.')) {
      const field = key.slice('ai_analysis.'.length);
      return doc.ai_analysis?.[field] ?? '';
    }
    return doc[key] ?? '';
  };

  const toggleAnalysisExpanded = (id: number) => {
    setExpandedAnalysis(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredDocs = useMemo(() => {
    let docs = documents;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d => {
        const ai = d.ai_analysis;
        return (
          d.name.toLowerCase().includes(q) ||
          d.folder_name?.toLowerCase().includes(q) ||
          d.tags?.some((t: any) => t.name.toLowerCase().includes(q)) ||
          ai?.city?.toLowerCase().includes(q) ||
          ai?.county?.toLowerCase().includes(q) ||
          ai?.streetName?.toLowerCase().includes(q) ||
          [ai?.addressNumber, ai?.streetName, ai?.suffix].filter(Boolean).join(' ').toLowerCase().includes(q)
        );
      });
    }
    if (sortConfig) {
      docs = [...docs].sort((a, b) => {
        const va = getSortValue(a, sortConfig.key);
        const vb = getSortValue(b, sortConfig.key);
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      });
    }
    return docs;
  }, [documents, searchQuery, sortConfig]);

  const groupedDocs = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    folders.forEach(f => { grouped[f.name] = []; });
    grouped['Unassigned'] = [];
    filteredDocs.forEach(d => {
      const gName = d.folder_name || 'Unassigned';
      if (!grouped[gName]) grouped[gName] = [];
      grouped[gName].push(d);
    });
    return grouped;
  }, [filteredDocs, folders]);

  const handleSwitchToAll = async () => {
    setViewMode('all');
    if (!adminDocuments) {
      setAdminDocsLoading(true);
      const res = await apiFetch('/api/admin/documents/');
      if (res.ok) setAdminDocuments(await res.json());
      setAdminDocsLoading(false);
    }
  };

  const filteredAdminDocs = useMemo(() => {
    if (!adminDocuments) return [];
    if (!searchQuery) return adminDocuments;
    const q = searchQuery.toLowerCase();
    return adminDocuments.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.folder_name?.toLowerCase().includes(q) ||
      d.owner_name.toLowerCase().includes(q) ||
      d.team_name?.toLowerCase().includes(q)
    );
  }, [adminDocuments, searchQuery]);

  const adminGrouped = useMemo(() => {
    const byTeam: Record<string, Record<string, AdminDoc[]>> = {};
    for (const doc of filteredAdminDocs) {
      const team = doc.team_name ?? 'No Team';
      const owner = doc.owner_name;
      if (!byTeam[team]) byTeam[team] = {};
      if (!byTeam[team][owner]) byTeam[team][owner] = [];
      byTeam[team][owner].push(doc);
    }
    return byTeam;
  }, [filteredAdminDocs]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleUserGroup = (key: string) => {
    setCollapsedUserGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const getFileIcon = (type: string) => {
    if (type === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
    if (type === "image") return <FileImage className="h-4 w-4 text-purple-500" />;
    if (type === "code") return <FileCode className="h-4 w-4 text-blue-500" />;
    return <FileIcon className="h-4 w-4 text-muted-foreground" />;
  };

  const hasAnalysis = (file: any) =>
    file.ai_analysis && typeof file.ai_analysis === 'object' && !file.ai_analysis.raw_response;

  const sortIcon = (key: string) => (
    <ArrowUpDown className={`inline h-3 w-3 ${sortConfig?.key === key ? 'text-primary' : 'opacity-30'}`} />
  );

  const tableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
          Name {sortIcon('name')}
        </TableHead>
        <TableHead>Tags</TableHead>
        <TableHead className="cursor-pointer" onClick={() => handleSort('owner_name')}>
          Owner {sortIcon('owner_name')}
        </TableHead>
        <TableHead className="cursor-pointer" onClick={() => handleSort('ai_score')}>
          Score {sortIcon('ai_score')}
        </TableHead>
        <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.city')}>
          City {sortIcon('ai_analysis.city')}
        </TableHead>
        <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.county')}>
          County {sortIcon('ai_analysis.county')}
        </TableHead>
        <TableHead>Folder</TableHead>
      </TableRow>
    </TableHeader>
  );

  const renderFileRow = (file: any) => {
    const isExpanded = expandedAnalysis.has(file.id);
    const hasAi = hasAnalysis(file);
    return (
      <React.Fragment key={file.id}>
        <TableRow className="hover:bg-muted/40">
          <TableCell>
            <div className="flex items-center gap-2">
              {getFileIcon(file.file_type)}
              <div className="flex flex-col">
                <span className="text-sm">{file.name}</span>
                {file.ai_analysis && (file.ai_analysis.addressNumber || file.ai_analysis.city || file.ai_analysis.county) && (
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {[
                      [file.ai_analysis.addressNumber, file.ai_analysis.streetName, file.ai_analysis.suffix].filter(Boolean).join(' '),
                      file.ai_analysis.city,
                      file.ai_analysis.county,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              {hasAi && (
                <Button
                  variant="ghost" size="sm"
                  className="h-6 gap-1 px-2 text-[10px] bg-green-500/10 text-green-600 hover:bg-green-500/20 border border-green-500/20 rounded-full"
                  onClick={() => toggleAnalysisExpanded(file.id)}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <Sparkles className="h-3 w-3" />Analyzed
                </Button>
              )}
            </div>
          </TableCell>
          <TableCell>
            <div className="flex flex-wrap gap-1">
              {file.tags?.map((t: any) => (
                <Badge key={t.id ?? t.name} variant="secondary" className="text-[10px]">{t.name}</Badge>
              ))}
            </div>
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">{file.owner_name}</TableCell>
          <TableCell>
            {file.ai_score
              ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">{file.ai_score}%</Badge>
              : "--"}
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.city || "--"}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.county || "--"}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{file.folder_name || "—"}</TableCell>
        </TableRow>
        {isExpanded && hasAi && (
          <TableRow className="bg-muted/30 hover:bg-muted/40">
            <TableCell colSpan={7} className="p-0">
              <div className="px-6 py-4 max-h-[500px] overflow-auto">
                <AnalysisReport analysis={file.ai_analysis} />
              </div>
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    );
  };

  const renderAdminFileRow = (file: AdminDoc) => (
    <TableRow key={file.id} className="hover:bg-muted/40">
      <TableCell>
        <div className="flex items-center gap-2">
          {getFileIcon(file.file_type)}
          <span className="text-sm">{file.name}</span>
          {file.analyzed && (
            <Badge className="text-[9px] h-4 px-1.5 gap-1 bg-green-500/10 text-green-600 border-green-500/20">
              <Sparkles className="h-2.5 w-2.5" />Analyzed
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell></TableCell>
      <TableCell className="text-xs text-muted-foreground">{file.owner_name}</TableCell>
      <TableCell>--</TableCell>
      <TableCell className="text-xs text-muted-foreground">--</TableCell>
      <TableCell className="text-xs text-muted-foreground">--</TableCell>
      <TableCell className="text-xs text-muted-foreground">{file.folder_name || "—"}</TableCell>
    </TableRow>
  );

  const emptyState = (
    <TableRow>
      <TableCell colSpan={7}>
        <div className="py-16 text-center space-y-3">
          <Search className="h-6 w-6 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">No files found.</p>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">File Explorer</h2>
          <p className="text-muted-foreground">View-only access to organization resources.</p>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <div className="flex rounded-lg border bg-card p-1 gap-1">
              <button
                onClick={() => setViewMode('folder')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'folder' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                My Team
              </button>
              <button
                onClick={handleSwitchToAll}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Users className="h-3.5 w-3.5" />
                All Files
              </button>
            </div>
          )}
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files, folders, tags, city, county..."
              className="pl-9 bg-card"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-explorer-search"
            />
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        {viewMode === 'all' ? (
          adminDocsLoading ? (
            <div className="py-20 text-center text-muted-foreground">Loading all files...</div>
          ) : (
            <Table>
              {tableHeader}
              <TableBody>
                {Object.keys(adminGrouped).length === 0 ? emptyState : (
                  Object.keys(adminGrouped).sort((a, b) => {
                    if (a === 'No Team') return 1;
                    if (b === 'No Team') return -1;
                    return a.localeCompare(b);
                  }).map((teamName) => {
                    const teamCollapsed = collapsedGroups.has(teamName);
                    const userMap = adminGrouped[teamName];
                    const teamTotal = Object.values(userMap).reduce((n, docs) => n + docs.length, 0);
                    return (
                      <React.Fragment key={teamName}>
                        <TableRow
                          className="bg-muted/30 hover:bg-muted/40 cursor-pointer"
                          onClick={() => toggleGroup(teamName)}
                        >
                          <TableCell colSpan={7}>
                            <div className="flex items-center gap-2">
                              {teamCollapsed
                                ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                              <Users className="h-4 w-4 text-primary" />
                              <span className="font-bold uppercase tracking-wider text-sm">{teamName}</span>
                              <Badge variant="secondary" className="ml-1">{teamTotal}</Badge>
                            </div>
                          </TableCell>
                        </TableRow>
                        {!teamCollapsed && Object.keys(userMap).sort((a, b) => a.localeCompare(b)).map((userName) => {
                          const userKey = `${teamName}::${userName}`;
                          const userCollapsed = collapsedUserGroups.has(userKey);
                          const docs = userMap[userName];
                          return (
                            <React.Fragment key={userKey}>
                              <TableRow
                                className="bg-muted/10 hover:bg-muted/20 cursor-pointer"
                                onClick={() => toggleUserGroup(userKey)}
                              >
                                <TableCell colSpan={7} className="pl-10">
                                  <div className="flex items-center gap-2">
                                    {userCollapsed
                                      ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-sm text-muted-foreground">@{userName}</span>
                                    <Badge variant="outline" className="ml-1 text-xs">{docs.length}</Badge>
                                  </div>
                                </TableCell>
                              </TableRow>
                              {!userCollapsed && docs.map(renderAdminFileRow)}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )
        ) : (
          <Table>
            {tableHeader}
            <TableBody>
              {Object.keys(groupedDocs).every(g => groupedDocs[g].length === 0) ? emptyState : (
                Object.entries(groupedDocs).map(([group, files]) => {
                  const isCollapsed = collapsedGroups.has(group);
                  return (
                    <React.Fragment key={group}>
                      <TableRow
                        className="bg-muted/20 hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggleGroup(group)}
                      >
                        <TableCell colSpan={7}>
                          <div className="flex items-center gap-2">
                            {isCollapsed
                              ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <FolderOpen className="h-4 w-4 text-primary" />
                            <span className="font-bold uppercase tracking-wider text-sm">{group}</span>
                            <Badge variant="secondary" className="ml-1">{files.length}</Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {!isCollapsed && files.map(renderFileRow)}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function InspectionSection({ title, data }: { title: string; data: any }) {
  if (!data) return null;

  if (title === "Additional Notes" && typeof data === 'object') {
    return (
      <div className="space-y-2 rounded-lg border p-3 bg-card">
        <h4 className="text-sm font-bold text-primary">{title}</h4>
        {Object.entries(data).map(([area, findings]: [string, any]) => (
          <div key={area} className="space-y-1">
            <p className="text-xs font-semibold text-foreground">{area}</p>
            {typeof findings === 'string' ? (
              <p className="text-xs text-muted-foreground ml-2">{findings}</p>
            ) : typeof findings === 'object' && findings !== null ? (
              <div className="ml-2 space-y-0.5">
                {Object.entries(findings).map(([k, v]: [string, any]) => (
                  <div key={k}>
                    {Array.isArray(v) ? (
                      <ul className="list-disc ml-4 space-y-0.5">
                        {v.map((item: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground">{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground"><span className="font-medium">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border p-3 bg-card">
      <h4 className="text-sm font-bold text-primary">{title}</h4>
      {data.condition && <p className="text-xs"><span className="font-medium text-foreground">Condition:</span> <span className="text-muted-foreground">{data.condition}</span></p>}
      {data.age && <p className="text-xs"><span className="font-medium text-foreground">Age:</span> <span className="text-muted-foreground">{data.age}</span></p>}
      {data.end_of_life && <p className="text-xs"><span className="font-medium text-foreground">End of Life:</span> <span className="text-muted-foreground">{data.end_of_life}</span></p>}
      {data.issues && Array.isArray(data.issues) && data.issues.length > 0 && (
        <div>
          <p className="text-xs font-medium text-foreground">Issues:</p>
          <ul className="list-disc ml-4 space-y-0.5">
            {data.issues.map((issue: string, i: number) => (
              <li key={i} className="text-xs text-muted-foreground">{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {data.recommendation && <p className="text-xs"><span className="font-medium text-foreground">Recommendation:</span> <span className="text-muted-foreground">{data.recommendation}</span></p>}
      {data.recommendations && <p className="text-xs"><span className="font-medium text-foreground">Recommendations:</span> <span className="text-muted-foreground">{data.recommendations}</span></p>}
      {data.notes && <p className="text-xs"><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{data.notes}</span></p>}
    </div>
  );
}

function AnalysisReport({ analysis }: { analysis: any }) {
  const summary = analysis.summary || {};
  const mainSections = ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC"];
  const otherSections = ["Permits", "Pest Inspection"];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-primary/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Property Information</h3>
          {analysis.document_type && <Badge variant="secondary" className="text-[10px]">{analysis.document_type}</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {analysis.addressNumber && <p><span className="font-medium">Address:</span> {analysis.addressNumber} {analysis.streetName} {analysis.suffix}</p>}
          {analysis.city && <p><span className="font-medium">City:</span> {analysis.city}</p>}
          {analysis.county && <p><span className="font-medium">County:</span> {analysis.county}</p>}
          {analysis.zipcode && <p><span className="font-medium">Zipcode:</span> {analysis.zipcode}</p>}
          {analysis.fileName && <p className="col-span-2"><span className="font-medium">File:</span> {analysis.fileName}</p>}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold">Inspection Summary</h3>
        <div className="grid grid-cols-1 gap-3">
          {mainSections.map(section => summary[section] && (
            <InspectionSection key={section} title={section} data={summary[section]} />
          ))}
        </div>
        {otherSections.map(section => summary[section] && (
          <InspectionSection key={section} title={section} data={summary[section]} />
        ))}
        {summary["Additional Notes"] && (
          <InspectionSection title="Additional Notes" data={summary["Additional Notes"]} />
        )}
      </div>
    </div>
  );
}
