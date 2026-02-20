import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  FileText, FileImage, FileCode, FileIcon, Search, FolderOpen, MoreVertical, Eye, Lock, ChevronRight, ChevronDown
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
                  <Card key={file.id} className="group hover:border-primary/50 transition-all hover:shadow-md cursor-pointer overflow-hidden border-border/40 bg-card/50">
                    <CardContent className="p-4 flex flex-col items-center text-center space-y-3 relative">
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
                            <DropdownMenuItem><Lock className="mr-2 h-4 w-4" /> Permissions</DropdownMenuItem>
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
    </div>
  );
}
