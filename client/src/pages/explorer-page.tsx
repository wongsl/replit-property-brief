import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, FileImage, FileCode, FileIcon, Search, FolderOpen,
  MoreVertical, Eye, ChevronRight, ChevronDown, Sparkles,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

async function apiFetch(url: string) {
  return fetch(url, { credentials: 'include' });
}

export default function ExplorerPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/documents/?scope=team'),
      apiFetch('/api/folders/'),
    ]).then(async ([docsRes, foldersRes]) => {
      if (docsRes.ok) setDocuments(await docsRes.json());
      if (foldersRes.ok) setFolders(await foldersRes.json());
    });
  }, []);

  const filteredDocs = useMemo(() => {
    if (!searchQuery) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.folder_name?.toLowerCase().includes(q) ||
      d.tags?.some((t: any) => t.name.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

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

  const getFileIcon = (type: string) => {
    if (type === "pdf") return <FileText className="h-8 w-8 text-red-500" />;
    if (type === "image") return <FileImage className="h-8 w-8 text-purple-500" />;
    if (type === "code") return <FileCode className="h-8 w-8 text-blue-500" />;
    return <FileIcon className="h-8 w-8 text-muted-foreground" />;
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]);
  };

  const hasAnalysis = (file: any) =>
    file.ai_analysis && typeof file.ai_analysis === 'object' && !file.ai_analysis.raw_response;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">File Explorer</h2>
          <p className="text-muted-foreground">View-only access to organization resources.</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search folders or files..." className="pl-9 bg-card" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-explorer-search" />
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedDocs).map(([group, files]) => (
          <div key={group} className="space-y-4">
            <button onClick={() => toggleGroup(group)} className="flex items-center gap-2 group w-full text-left">
              {collapsedGroups.includes(group) ? <ChevronRight className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
              <FolderOpen className="h-5 w-5 text-primary" />
              <h3 className="font-bold uppercase tracking-wider text-sm">{group}</h3>
              <Badge variant="secondary" className="ml-2">{files.length}</Badge>
              <div className="flex-1 h-px bg-border ml-4" />
            </button>
            {!collapsedGroups.includes(group) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {files.map((file: any) => (
                  <Card
                    key={file.id}
                    className="group hover:border-primary/50 transition-all hover:shadow-md cursor-pointer overflow-hidden border-border/40 bg-card/50"
                    onClick={() => setSelectedFile(file)}
                  >
                    <CardContent className="p-4 flex flex-col items-center text-center space-y-3 relative">
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedFile(file); }}>
                              <Eye className="mr-2 h-4 w-4" /> View Details
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="p-4 bg-background rounded-xl group-hover:scale-110 transition-transform shadow-sm border">
                        {getFileIcon(file.file_type)}
                      </div>
                      <div className="space-y-1 w-full overflow-hidden">
                        <p className="font-medium text-sm truncate px-2">{file.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{file.file_size} &middot; {file.file_type}</p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-1">
                        {hasAnalysis(file) && (
                          <Badge className="text-[9px] h-4 px-1.5 gap-1 bg-green-500/10 text-green-600 border-green-500/20">
                            <Sparkles className="h-2.5 w-2.5" />Analyzed
                          </Badge>
                        )}
                        {file.tags?.slice(0, 2).map((t: any) => (
                          <Badge key={t.id} variant="outline" className="text-[9px] h-4 px-1 lowercase font-normal">{t.name}</Badge>
                        ))}
                        {file.tags?.length > 2 && <Badge variant="outline" className="text-[9px] h-4 px-1">+{file.tags.length - 2}</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ))}
        {Object.keys(groupedDocs).length === 0 && (
          <div className="py-20 text-center space-y-4 border-2 border-dashed rounded-3xl bg-muted/20">
            <Search className="h-6 w-6 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No files found.</p>
          </div>
        )}
      </div>

      {/* File detail / analysis dialog */}
      <Dialog open={!!selectedFile} onOpenChange={(open) => !open && setSelectedFile(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedFile && getFileIcon(selectedFile.file_type)}
              <span className="truncate">{selectedFile?.name}</span>
              {selectedFile && hasAnalysis(selectedFile) && (
                <Badge className="ml-2 shrink-0 bg-green-500/10 text-green-600 border-green-500/20 gap-1">
                  <Sparkles className="h-3 w-3" />Analyzed
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedFile && (
            <div className="space-y-4 pt-2">
              {/* File metadata */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Type:</span> {selectedFile.file_type}</div>
                <div><span className="text-muted-foreground">Size:</span> {selectedFile.file_size}</div>
                <div><span className="text-muted-foreground">Owner:</span> {selectedFile.owner_name}</div>
                <div><span className="text-muted-foreground">Folder:</span> {selectedFile.folder_name || "—"}</div>
                {selectedFile.tags?.length > 0 && (
                  <div className="col-span-2 flex flex-wrap gap-1 items-center">
                    <span className="text-muted-foreground">Tags:</span>
                    {selectedFile.tags.map((t: any) => (
                      <Badge key={t.id} variant="secondary" className="text-[10px]">{t.name}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Analysis */}
              {hasAnalysis(selectedFile) ? (
                <AnalysisReport analysis={selectedFile.ai_analysis} />
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No analysis available for this file.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InspectionSection({ title, data }: { title: string; data: any }) {
  if (!data) return null;

  if (title === "Additional Notes" && typeof data === 'object') {
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-primary">{title}</h4>
        {Object.entries(data).map(([area, findings]: [string, any]) => (
          <div key={area} className="ml-3 space-y-1">
            <p className="text-xs font-semibold text-foreground">{area}</p>
            {typeof findings === 'string' ? (
              <p className="text-xs text-muted-foreground ml-2">{findings}</p>
            ) : typeof findings === 'object' && findings !== null ? (
              <div className="ml-2 space-y-0.5">
                {Object.entries(findings).map(([k, v]: [string, any]) => (
                  <p key={k} className="text-xs text-muted-foreground"><span className="font-medium">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
