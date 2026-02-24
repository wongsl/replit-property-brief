import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/mock-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileIcon, UploadCloud, RefreshCw, Search, MoreHorizontal,
  FileText, FileImage, FileCode, Download, Users, Sparkles,
  ArrowUpDown, LayoutDashboard, FolderOpen, GripVertical, Plus, Minus, ChevronRight, ChevronDown, Tag, X, FolderPlus, Folder, Trash2,
  EyeOff, Lock, Coins, Copy, Check, Star, StickyNote, Layers
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  DndContext, closestCenter, pointerWithin, rectIntersection, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import { cn } from "@/lib/utils";

async function apiFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'include',
  });
  return res;
}

function flattenFolders(folders: any[], prefix = ""): { id: number; name: string; fullPath: string; depth: number }[] {
  const result: { id: number; name: string; fullPath: string; depth: number }[] = [];
  for (const f of folders) {
    const path = prefix ? `${prefix} / ${f.name}` : f.name;
    const depth = prefix ? prefix.split(" / ").length : 0;
    result.push({ id: f.id, name: f.name, fullPath: path, depth });
    if (f.children && f.children.length > 0) {
      result.push(...flattenFolders(f.children, path));
    }
  }
  return result;
}

function findFolderById(folders: any[], id: number): any | null {
  for (const f of folders) {
    if (f.id === id) return f;
    if (f.children) {
      const found = findFolderById(f.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getAllFolderIds(folders: any[]): number[] {
  const ids: number[] = [];
  for (const f of folders) {
    ids.push(f.id);
    if (f.children) ids.push(...getAllFolderIds(f.children));
  }
  return ids;
}

function getDescendantIds(folder: any): number[] {
  const ids: number[] = [];
  if (folder.children) {
    for (const c of folder.children) {
      ids.push(c.id);
      ids.push(...getDescendantIds(c));
    }
  }
  return ids;
}

function addCombinedAnalysisToFolder(folder: any, targetFolderId: number, record: any): any {
  if (folder.id === targetFolderId) {
    return { ...folder, combined_analyses: [...(folder.combined_analyses || []), record] };
  }
  if (folder.children) {
    return { ...folder, children: folder.children.map((c: any) => addCombinedAnalysisToFolder(c, targetFolderId, record)) };
  }
  return folder;
}

function removeCombinedAnalysisFromFolder(folder: any, recordId: number): any {
  return {
    ...folder,
    combined_analyses: (folder.combined_analyses || []).filter((ca: any) => ca.id !== recordId),
    children: (folder.children || []).map((c: any) => removeCombinedAnalysisFromFolder(c, recordId)),
  };
}

export default function DashboardPage() {
  const { user, refreshUser, decrementRateLimit, rateLimitRemaining, resetRateLimit } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [teams, setTeams] = useState<{id: number, name: string}[]>([]);
  const [activeTab, setActiveTab] = useState("my-files");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadPrivate, setUploadPrivate] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [groupBy, setGroupBy] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingFileId, setEditingFileId] = useState<number | null>(null);
  const [tempFileName, setTempFileName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<number>>(new Set());
  const [addingSubfolderTo, setAddingSubfolderTo] = useState<number | null>(null);
  const [subfolderName, setSubfolderName] = useState("");
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);
  const [myCreditRequest, setMyCreditRequest] = useState<any | null>(undefined);
  const [creditRequestAmount, setCreditRequestAmount] = useState(5);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set());
  const [isCombining, setIsCombining] = useState(false);
  const [expandedCombinedAnalyses, setExpandedCombinedAnalyses] = useState<Set<number>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const customCollisionDetection: CollisionDetection = (args) => {
    const activeId = String(args.active.id);
    if (!activeId.startsWith('folder-')) {
      // Document drag — use drop-folder droppable zones
      const dropFolderContainers = args.droppableContainers.filter(c => String(c.id).startsWith('drop-folder-'));
      const pointerCollisions = pointerWithin({ ...args, droppableContainers: dropFolderContainers });
      if (pointerCollisions.length > 0) return pointerCollisions;
      return rectIntersection({ ...args, droppableContainers: dropFolderContainers });
    }
    // Folder drag — check if pointer is directly over a different folder (for nesting)
    const activeFolderIdStr = activeId.replace('folder-', '');
    const dropFolderContainers = args.droppableContainers.filter(c => {
      const cId = String(c.id);
      return cId.startsWith('drop-folder-') && cId !== `drop-folder-${activeFolderIdStr}`;
    });
    const pointerCollisions = pointerWithin({ ...args, droppableContainers: dropFolderContainers });
    if (pointerCollisions.length > 0) return pointerCollisions;
    // Fall back to sortable reordering
    const sortableContainers = args.droppableContainers.filter(c => String(c.id).startsWith('folder-'));
    return closestCenter({ ...args, droppableContainers: sortableContainers });
  };

  const flatFolders = useMemo(() => flattenFolders(folders), [folders]);

  const loadData = async () => {
    const scope = activeTab === "team-files" ? "team" : "mine";
    const [docsRes, foldersRes] = await Promise.all([
      apiFetch(`/api/documents/?scope=${scope}`),
      apiFetch('/api/folders/'),
    ]);
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (foldersRes.ok) setFolders(await foldersRes.json());
  };

  useEffect(() => { loadData(); }, [activeTab]);

  useEffect(() => {
    apiFetch('/api/teams/').then(r => r.ok ? r.json() : []).then(setTeams).catch(() => {});
  }, []);

  const loadCreditRequest = () => {
    apiFetch('/api/credits/request/').then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setMyCreditRequest(data.id ? data : null);
      }
    });
  };

  useEffect(() => { loadCreditRequest(); }, []);

  const handleCreditRequest = async () => {
    if (creditRequestAmount < 1 || creditRequestAmount > 10) return;
    const res = await apiFetch('/api/credits/request/', {
      method: 'POST',
      body: JSON.stringify({ amount: creditRequestAmount }),
    });
    const data = await res.json();
    if (res.ok) {
      setMyCreditRequest(data);
      toast({ title: "Request submitted", description: `Requested ${creditRequestAmount} credit${creditRequestAmount > 1 ? 's' : ''}. An admin will review it.` });
    } else {
      toast({ title: "Could not submit request", description: data.error, variant: "destructive" });
    }
  };

  const handleCancelCreditRequest = async () => {
    const res = await apiFetch('/api/credits/request/cancel/', { method: 'DELETE' });
    if (res.ok) {
      setMyCreditRequest(null);
      toast({ title: "Request cancelled", description: "Your credit request has been withdrawn." });
    }
  };

  const handleCreateGroup = async (parentId?: number) => {
    const name = parentId ? subfolderName.trim() : newGroupName.trim();
    if (!name || !decrementRateLimit()) return;
    const body: any = { name };
    if (parentId) body.parent = parentId;
    const res = await apiFetch('/api/folders/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res.ok) {
      if (parentId) {
        setSubfolderName("");
        setAddingSubfolderTo(null);
        collapsedGroups.delete(`folder-${parentId}`);
        setCollapsedGroups(new Set(collapsedGroups));
      } else {
        setNewGroupName("");
      }
      loadData();
    }
  };

  const handleRenameFile = async (id: number) => {
    if (!tempFileName.trim() || !decrementRateLimit()) return;
    await apiFetch(`/api/documents/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name: tempFileName.trim() }),
    });
    setEditingFileId(null);
    loadData();
  };

  const handleAddTag = async (docId: number, tag: string) => {
    if (!tag.trim() || !decrementRateLimit()) return;
    await apiFetch(`/api/documents/${docId}/add_tag/`, {
      method: 'POST',
      body: JSON.stringify({ name: tag }),
    });
    loadData();
  };

  const handleRemoveTag = async (docId: number, tag: string) => {
    await apiFetch(`/api/documents/${docId}/remove_tag/`, {
      method: 'POST',
      body: JSON.stringify({ name: tag }),
    });
    loadData();
  };

  const handleAnalyze = async (targetFile?: any) => {
    const fileToAnalyze = targetFile || selectedFile;
    if (!fileToAnalyze || !decrementRateLimit()) return;
    if ((user?.credits ?? 0) < 1) {
      toast({ title: "No credits remaining", description: "Request more credits on the Teams page.", variant: "destructive" });
      return;
    }
    setSelectedFile(fileToAnalyze);
    setIsAnalyzing(true);
    const res = await apiFetch(`/api/documents/${fileToAnalyze.id}/analyze/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const updated = await res.json();
      setSelectedFile(updated);
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      setExpandedAnalysis(prev => new Set(prev).add(updated.id));
      await refreshUser();
    } else if (res.status === 402) {
      const err = await res.json();
      toast({ title: "No credits remaining", description: err.error, variant: "destructive" });
      await refreshUser();
    }
    setIsAnalyzing(false);
  };

  const categorizeName = (fileName: string, allFolders: any[]): { matchedFolder: any | null; suggestedName: string } => {
    const name = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

    const suffixes = ["st", "nd", "rd", "th", "ave", "avenue", "blvd", "boulevard", "cir", "circle", "ct", "court", "dr", "drive", "hwy", "highway", "ln", "lane", "pkwy", "parkway", "pl", "place", "rd", "road", "sq", "square", "st", "street", "ter", "terrace", "trl", "trail", "way", "wy"];
    const suffixPattern = suffixes.join("|");

    const addressRegex = new RegExp(`(\\d+)\\s+((?:[a-zA-Z]+\\s+){0,3}(?:${suffixPattern}))`, "i");
    const match = name.match(addressRegex);

    if (match) {
      const number = match[1];
      const streetPart = match[2].trim().replace(/\s+/g, ' ');
      const address = `${number} ${streetPart.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')}`;

      const existing = allFolders.find(f => f.fullPath.toLowerCase().includes(address.toLowerCase()));
      if (existing) return { matchedFolder: existing, suggestedName: "" };
      return { matchedFolder: null, suggestedName: address };
    }

    const simpleMatch = name.match(/(\d+)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/);
    if (simpleMatch) {
      const number = simpleMatch[1];
      const street = simpleMatch[2].trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      const address = `${number} ${street}`;

      const existing = allFolders.find(f => f.fullPath.toLowerCase().includes(address.toLowerCase()));
      if (existing) return { matchedFolder: existing, suggestedName: "" };
      return { matchedFolder: null, suggestedName: address };
    }

    return { matchedFolder: null, suggestedName: "" };
  };

  const handleUpload = async (isPrivate = false) => {
    if (!decrementRateLimit()) return;
    setShowUploadDialog(false);
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsUploading(true);
      setUploadProgress(10);

      try {
        const urlRes = await fetch('/api/uploads/request-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type || 'application/octet-stream',
          }),
        });
        if (!urlRes.ok) throw new Error('Failed to get upload URL');
        const { uploadURL, objectPath } = await urlRes.json();

        setUploadProgress(30);

        const s3Res = await fetch(uploadURL, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!s3Res.ok) {
          throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);
        }

        setUploadProgress(70);

        const res = await apiFetch('/api/documents/', {
          method: 'POST',
          body: JSON.stringify({
            name: file.name,
            storage_path: objectPath,
            file_size: file.size,
            is_private: isPrivate,
          }),
        });

        if (res.ok) {
          const newDoc = await res.json();
          setUploadProgress(85);

          const foldersRes = await apiFetch('/api/folders/');
          const currentFolders = foldersRes.ok ? await foldersRes.json() : folders;
          const currentFlat = flattenFolders(currentFolders);

          const { matchedFolder, suggestedName } = categorizeName(file.name, currentFlat);

          if (matchedFolder) {
            await apiFetch(`/api/documents/${newDoc.id}/move/`, {
              method: 'POST',
              body: JSON.stringify({ folder_id: matchedFolder.id }),
            });
          } else if (suggestedName) {
            const folderRes = await apiFetch('/api/folders/', {
              method: 'POST',
              body: JSON.stringify({ name: suggestedName }),
            });
            if (folderRes.ok) {
              const newFolder = await folderRes.json();
              await apiFetch(`/api/documents/${newDoc.id}/move/`, {
                method: 'POST',
                body: JSON.stringify({ folder_id: newFolder.id }),
              });
            }
          }

          setUploadProgress(100);
          loadData();
        }
      } catch (err) {
        console.error('Upload failed:', err);
      }
      setTimeout(() => setIsUploading(false), 500);
    };
    input.click();
  };

  const handleMoveToFolder = async (docId: number, folderId: number | null) => {
    await apiFetch(`/api/documents/${docId}/move/`, {
      method: 'POST',
      body: JSON.stringify({ folder_id: folderId }),
    });
    loadData();
  };

  const handleDeleteFolder = async (folderId: number) => {
    const res = await apiFetch(`/api/folders/${folderId}/`, { method: 'DELETE' });
    if (res.ok) loadData();
  };

  const handleMoveFolder = async (folderId: number, newParentId: number | null) => {
    const res = await apiFetch(`/api/folders/${folderId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ parent: newParentId === null ? '' : newParentId }),
    });
    if (res.ok) loadData();
  };

  const handleChangeTeam = async (docId: number, teamId: number | null) => {
    await apiFetch(`/api/documents/${docId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ team: teamId }),
    });
    loadData();
  };

  const handleTogglePrivate = async (docId: number, currentlyPrivate: boolean) => {
    await apiFetch(`/api/documents/${docId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ is_private: !currentlyPrivate }),
    });
    loadData();
  };

  const toggleNotesExpanded = (docId: number) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId); else next.add(docId);
      return next;
    });
  };

  const handleSaveNote = async (docId: number, notes: string) => {
    const res = await apiFetch(`/api/documents/${docId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, notes } : d));
    }
  };

  const handleToggleFavorite = async (docId: number) => {
    const res = await apiFetch(`/api/documents/${docId}/toggle_favorite/`, { method: 'POST' });
    if (res.ok) {
      const { is_favorited } = await res.json();
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, is_favorited } : d));
    }
  };

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);

  const handleDragStart = (event: any) => setActiveDragId(event.active.id);
  const handleDragOver = (event: any) => {
    const { active, over } = event;
    if (!over) { setDragOverFolderId(null); return; }
    const activeStr = String(active.id);
    const overStr = String(over.id);
    if (overStr.startsWith('drop-folder-')) {
      const targetFolderId = parseInt(overStr.replace('drop-folder-', ''));
      // For folder drags, don't highlight if hovering over itself
      if (activeStr.startsWith('folder-') && parseInt(activeStr.replace('folder-', '')) === targetFolderId) {
        setDragOverFolderId(null);
      } else {
        setDragOverFolderId(targetFolderId);
      }
    } else {
      setDragOverFolderId(null);
    }
  };
  const handleDragEnd = (event: any) => {
    setActiveDragId(null);
    setDragOverFolderId(null);
    const { active, over } = event;
    if (!over) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    if (!activeStr.startsWith('folder-') && overStr.startsWith('drop-folder-')) {
      // Document dropped into a folder
      const folderId = parseInt(overStr.replace('drop-folder-', ''));
      handleMoveToFolder(active.id, folderId);
    } else if (activeStr.startsWith('folder-') && overStr.startsWith('drop-folder-')) {
      // Folder dragged onto another folder — nest it
      const draggedFolderId = parseInt(activeStr.replace('folder-', ''));
      const targetFolderId = parseInt(overStr.replace('drop-folder-', ''));
      if (draggedFolderId !== targetFolderId) {
        handleMoveFolder(draggedFolderId, targetFolderId);
      }
    } else if (activeStr.startsWith('folder-') && overStr.startsWith('folder-')) {
      // Folder dragged between folders — reorder
      const activeIdx = folders.findIndex(f => `folder-${f.id}` === activeStr);
      const overIdx = folders.findIndex(f => `folder-${f.id}` === overStr);
      if (activeIdx !== -1 && overIdx !== -1) {
        const newOrder = arrayMove(folders, activeIdx, overIdx);
        setFolders(newOrder);
        apiFetch('/api/folders/reorder/', {
          method: 'POST',
          body: JSON.stringify({ order: newOrder.map(f => f.id) }),
        });
      }
    }
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const toggleAnalysisExpanded = (fileId: number) => {
    setExpandedAnalysis(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const toggleDocSelection = (docId: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleCombinedExpanded = (recordId: number) => {
    setExpandedCombinedAnalyses(prev => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const handleCombineAnalysis = async () => {
    const ids = Array.from(selectedDocIds);
    if (ids.length < 2) return;

    const selected = documents.filter(d => ids.includes(d.id));
    const folderIds = Array.from(new Set(selected.map((d: any) => d.folder).filter(Boolean)));
    if (folderIds.length !== 1) {
      toast({ title: "Select documents from the same folder", description: "All selected documents must be in the same folder.", variant: "destructive" });
      return;
    }
    if ((user?.credits ?? 0) < 1) {
      toast({ title: "No credits remaining", description: "Request more credits on the Teams page.", variant: "destructive" });
      return;
    }

    setIsCombining(true);
    try {
      const res = await apiFetch(`/api/folders/${folderIds[0]}/combined-analysis/`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: ids }),
      });
      if (res.ok) {
        const record = await res.json();
        setFolders(prev => prev.map(f => addCombinedAnalysisToFolder(f, folderIds[0] as number, record)));
        setSelectedDocIds(new Set());
        setExpandedCombinedAnalyses(prev => new Set(prev).add(record.id));
        await refreshUser();
        toast({ title: "Combined analysis created" });
      } else if (res.status === 402) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "No credits remaining", description: err.error, variant: "destructive" });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not combine analyses", description: err.error || "Please try again.", variant: "destructive" });
      }
    } finally {
      setIsCombining(false);
    }
  };

  const handleDeleteCombinedAnalysis = async (recordId: number) => {
    const res = await apiFetch(`/api/combined-analyses/${recordId}/`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setFolders(prev => prev.map(f => removeCombinedAnalysisFromFolder(f, recordId)));
    }
  };

  const getSortValue = (doc: any, key: string) => {
    if (key.startsWith('ai_analysis.')) {
      const field = key.slice('ai_analysis.'.length);
      return doc.ai_analysis?.[field] ?? '';
    }
    return doc[key] ?? '';
  };

  const filteredDocs = useMemo(() => {
    let docs = documents;
    if (showFavoritesOnly) {
      docs = docs.filter(d => d.is_favorited);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d => {
        const ai = d.ai_analysis;
        return (
          d.name.toLowerCase().includes(q) ||
          d.tags?.some((t: any) => t.name.toLowerCase().includes(q)) ||
          d.folder_name?.toLowerCase().includes(q) ||
          ai?.city?.toLowerCase().includes(q) ||
          ai?.county?.toLowerCase().includes(q) ||
          ai?.streetName?.toLowerCase().includes(q) ||
          [ai?.addressNumber, ai?.streetName, ai?.suffix].filter(Boolean).join(' ').toLowerCase().includes(q)
        );
      });
    }
    if (sortConfig) {
      docs = [...docs].sort((a: any, b: any) => {
        const va = getSortValue(a, sortConfig.key);
        const vb = getSortValue(b, sortConfig.key);
        return sortConfig.direction === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });
    }
    return docs;
  }, [documents, searchQuery, sortConfig, showFavoritesOnly]);

  const docsByFolder = useMemo(() => {
    const map: Record<number | string, any[]> = { unassigned: [] };
    const allIds = getAllFolderIds(folders);
    allIds.forEach(id => { map[id] = []; });
    filteredDocs.forEach(d => {
      if (d.folder && map[d.folder] !== undefined) {
        map[d.folder].push(d);
      } else {
        map['unassigned'].push(d);
      }
    });
    return map;
  }, [filteredDocs, folders]);

  const getFileIcon = (type: string) => {
    if (type === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
    if (type === "image") return <FileImage className="h-4 w-4 text-purple-500" />;
    if (type === "code") return <FileCode className="h-4 w-4 text-blue-500" />;
    return <FileIcon className="h-4 w-4 text-muted-foreground" />;
  };

  const fileRowProps = {
    getFileIcon, user, decrementRateLimit,
    setSelectedFile, editingFileId, setEditingFileId,
    tempFileName, setTempFileName, handleRenameFile,
    handleAddTag, handleRemoveTag,
    flatFolders, handleMoveToFolder,
    handleAnalyze, isAnalyzing, selectedFile, rateLimitRemaining,
    expandedAnalysis, toggleAnalysisExpanded,
    teams, handleChangeTeam, handleTogglePrivate, handleToggleFavorite,
    expandedNotes, toggleNotesExpanded, handleSaveNote,
    userCredits: user?.credits ?? 0,
    selectedDocIds, toggleDocSelection,
    expandedCombinedAnalyses, toggleCombinedExpanded, handleDeleteCombinedAnalysis,
  };

  const countDocsInTree = (folder: any): number => {
    let count = (docsByFolder[folder.id] || []).length;
    if (folder.children) {
      folder.children.forEach((c: any) => { count += countDocsInTree(c); });
    }
    return count;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">Documents</h2>
          <p className="text-muted-foreground">Manage, group, and analyze your files.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreditsDialog(true)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-opacity hover:opacity-80 ${(user?.credits ?? 0) === 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : (user?.credits ?? 0) <= 2 ? 'border-orange-400/40 bg-orange-500/10 text-orange-500' : 'border-primary/30 bg-primary/5 text-primary'}`}
          >
            <Coins className="h-3.5 w-3.5" />
            {user?.credits ?? 0} {(user?.credits ?? 0) === 1 ? 'credit' : 'credits'} left
          </button>
<Button onClick={() => { setUploadPrivate(false); setShowUploadDialog(true); }} disabled={isUploading || rateLimitRemaining <= 0} data-testid="button-upload">
            <UploadCloud className="mr-2 h-4 w-4" />{isUploading ? "Uploading..." : "Upload File"}
          </Button>
        </div>
      </div>

      {isUploading && (
        <Card className="border-primary/20 bg-primary/5"><CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">Uploading...</span><span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="my-files" className="gap-2"><FileText className="h-4 w-4" />My Files</TabsTrigger>
              <TabsTrigger value="team-files" className="gap-2"><Users className="h-4 w-4" />Team Files</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant={groupBy ? "secondary" : "outline"} size="sm" className="gap-2" onClick={() => setGroupBy(!groupBy)}>
            <LayoutDashboard className="h-4 w-4" />{groupBy ? "Ungroup" : "Group Files"}
          </Button>
          <Button variant={showFavoritesOnly ? "secondary" : "outline"} size="sm" className="gap-2" onClick={() => setShowFavoritesOnly(v => !v)}>
            <Star className={`h-4 w-4 ${showFavoritesOnly ? 'fill-yellow-400 text-yellow-400' : ''}`} />Favorites
          </Button>
          <div className="flex items-center gap-2 border-l pl-4">
            <Input placeholder="New Client Folder..." value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="h-8 w-40 text-xs" data-testid="input-new-folder" />
            <Button size="sm" variant="outline" className="h-8" onClick={() => handleCreateGroup()} data-testid="button-create-folder"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search files, folders, tags, city, county, address..." className="pl-9 bg-card" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-search" />
        </div>
      </div>

      {selectedDocIds.size >= 2 && (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5">
          <Layers className="h-4 w-4 text-indigo-500 shrink-0" />
          <span className="text-sm font-medium text-indigo-600">{selectedDocIds.size} documents selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setSelectedDocIds(new Set())}
            >
              Clear
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleCombineAnalysis}
              disabled={isCombining}
            >
              {isCombining ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
              {isCombining ? "Combining..." : "Combine Analysis"}
            </Button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={customCollisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveDragId(null); setDragOverFolderId(null); }}>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>Name <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('owner_name')}>Owner <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_score')}>Score <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.city')}>
                  City {sortConfig?.key === 'ai_analysis.city' && <ArrowUpDown className="inline h-3 w-3 text-primary" />}
                  {sortConfig?.key !== 'ai_analysis.city' && <ArrowUpDown className="inline h-3 w-3 opacity-30" />}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.county')}>
                  County {sortConfig?.key === 'ai_analysis.county' && <ArrowUpDown className="inline h-3 w-3 text-primary" />}
                  {sortConfig?.key !== 'ai_analysis.county' && <ArrowUpDown className="inline h-3 w-3 opacity-30" />}
                </TableHead>
                <TableHead>Folder</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBy ? (
                <>
                  <SortableContext items={folders.map(f => `folder-${f.id}`)} strategy={verticalListSortingStrategy}>
                    {folders.map(folder => (
                      <FolderTreeSection
                        key={folder.id}
                        folder={folder}
                        depth={0}
                        docsByFolder={docsByFolder}
                        collapsedGroups={collapsedGroups}
                        toggleGroupCollapse={toggleGroupCollapse}
                        addingSubfolderTo={addingSubfolderTo}
                        setAddingSubfolderTo={setAddingSubfolderTo}
                        subfolderName={subfolderName}
                        setSubfolderName={setSubfolderName}
                        handleCreateGroup={handleCreateGroup}
                        handleDeleteFolder={handleDeleteFolder}
                        handleMoveFolder={handleMoveFolder}
                        countDocsInTree={countDocsInTree}
                        dragOverFolderId={dragOverFolderId}
                        {...fileRowProps}
                      />
                    ))}
                  </SortableContext>
                  {(docsByFolder['unassigned'] || []).length > 0 && (
                    <>
                      <TableRow className="bg-muted/40 border-b-2">
                        <TableCell></TableCell>
                        <TableCell colSpan={8} className="py-2">
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleGroupCollapse('unassigned')}>
                              {collapsedGroups.has('unassigned') ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            <span className="font-bold text-xs uppercase tracking-tight text-muted-foreground">Unassigned</span>
                            <Badge variant="outline" className="text-[10px] h-4">{(docsByFolder['unassigned'] || []).length}</Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                      {!collapsedGroups.has('unassigned') && (docsByFolder['unassigned'] || []).map((file: any) => (
                        <FileRow key={file.id} file={file} {...fileRowProps} />
                      ))}
                    </>
                  )}
                </>
              ) : (
                <SortableContext items={filteredDocs.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  {filteredDocs.map((file) => (
                    <FileRow key={file.id} file={file} {...fileRowProps} />
                  ))}
                </SortableContext>
              )}
              {filteredDocs.length === 0 && (
                <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No documents found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        <DragOverlay>
          {activeDragId ? (() => {
            const isFolder = String(activeDragId).startsWith('folder-');
            if (isFolder) {
              const f = flatFolders.find(fl => `folder-${fl.id}` === activeDragId);
              const depth = f?.depth || 0;
              return (
                <div
                  className="bg-background/90 border p-2 rounded shadow-lg flex items-center gap-2 min-w-[120px]"
                  style={{ paddingLeft: depth * 12 + 8 }}
                >
                  <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{depth > 0 ? '└ ' : ''}{f?.name}</span>
                </div>
              );
            }
            const doc = documents.find(d => d.id === activeDragId);
            return (
              <div className="bg-background/90 border p-2 rounded shadow-lg flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{doc?.name}</span>
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={showCreditsDialog} onOpenChange={setShowCreditsDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Analysis Credits
            </DialogTitle>
            <DialogDescription>
              You have <strong>{user?.credits ?? 0}</strong> credit{(user?.credits ?? 1) !== 1 ? 's' : ''} left. Each analysis costs 1 credit.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {myCreditRequest === undefined ? null : myCreditRequest !== null ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Request pending</p>
                  <p className="text-xs text-muted-foreground">
                    {myCreditRequest.amount} credit{myCreditRequest.amount > 1 ? 's' : ''} requested · {new Date(myCreditRequest.requested_at).toLocaleDateString()}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleCancelCreditRequest}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Request up to 10 credits. An admin will review your request.</p>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Amount to request</label>
                  <div className="flex items-center gap-1 border rounded-md">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-r-none" onClick={() => setCreditRequestAmount(a => Math.max(1, a - 1))}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{creditRequestAmount}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-l-none" onClick={() => setCreditRequestAmount(a => Math.min(10, a + 1))}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreditsDialog(false)}>Close</Button>
            {myCreditRequest === null && (
              <Button onClick={handleCreditRequest}>
                <Coins className="mr-2 h-4 w-4" />Request {creditRequestAmount} Credits
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>Choose your privacy setting before selecting a file.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {user?.team ? (
              <button
                onClick={() => setUploadPrivate(!uploadPrivate)}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${uploadPrivate ? 'border-orange-400/50 bg-orange-500/10' : 'border-primary/30 bg-primary/5 hover:bg-primary/10'}`}
              >
                {uploadPrivate
                  ? <Lock className="h-5 w-5 text-orange-500 shrink-0" />
                  : <Users className="h-5 w-5 text-primary shrink-0" />}
                <div>
                  <p className="text-sm font-medium">{uploadPrivate ? 'Private (only you)' : `Shared with ${user.team_name || 'team'}`}</p>
                  <p className="text-xs text-muted-foreground">{uploadPrivate ? 'Hidden from team view' : 'Visible in Team Files'}</p>
                </div>
                <span className="ml-auto text-xs text-muted-foreground">click to toggle</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border p-3 text-muted-foreground">
                <Lock className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Private (only you)</p>
                  <p className="text-xs">You are not in a team</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>Cancel</Button>
            <Button onClick={() => handleUpload(uploadPrivate)}>
              <UploadCloud className="mr-2 h-4 w-4" />Choose File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderTreeSection({ folder, depth, docsByFolder, collapsedGroups, toggleGroupCollapse, addingSubfolderTo, setAddingSubfolderTo, subfolderName, setSubfolderName, handleCreateGroup, handleDeleteFolder, handleMoveFolder, countDocsInTree, dragOverFolderId, ...fileRowProps }: any) {
  const { flatFolders } = fileRowProps;
  const collapseKey = `folder-${folder.id}`;
  const isCollapsed = collapsedGroups.has(collapseKey);
  const docs = docsByFolder[folder.id] || [];
  const children = folder.children || [];
  const totalDocs = countDocsInTree(folder);
  const isAddingSub = addingSubfolderTo === folder.id;

  const isRoot = depth === 0;
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition } = useSortable({ id: `folder-${folder.id}`, disabled: !isRoot });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: `drop-folder-${folder.id}` });
  const style = isRoot ? { transform: CSS.Transform.toString(transform), transition } : {};
  const isDragTarget = dragOverFolderId === folder.id;
  const combinedRef = (node: HTMLTableRowElement | null) => {
    if (isRoot) setSortableRef(node);
    setDroppableRef(node);
  };

  const depthColors = [
    "bg-muted/40",
    "bg-primary/5",
    "bg-accent/10",
  ];
  const bgColor = depthColors[Math.min(depth, depthColors.length - 1)];

  const folderIcons = [
    <FolderOpen key="root" className="h-4 w-4 text-primary" />,
    <Folder key="child" className="h-4 w-4 text-blue-500" />,
    <FolderOpen key="leaf" className="h-4 w-4 text-green-500" />,
  ];
  const folderIcon = folderIcons[Math.min(depth, folderIcons.length - 1)];

  return (
    <React.Fragment>
      <TableRow ref={combinedRef} style={style} className={cn(bgColor, "border-b-2", isDragTarget && "ring-2 ring-primary ring-inset bg-primary/10 transition-all duration-150")}>
        <TableCell>
          {isRoot && (
            <div {...attributes} {...listeners} className="cursor-grab p-1 hover:bg-muted rounded">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </TableCell>
        <TableCell colSpan={8} className="py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 }}>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleGroupCollapse(collapseKey)}>
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {folderIcon}
            <span className={cn("font-bold text-xs uppercase tracking-tight", depth === 0 && "text-sm")}>{folder.name}</span>
            <Badge variant="outline" className="text-[10px] h-4">{totalDocs}</Badge>
            {isDragTarget && (
              <Badge variant="default" className="text-[10px] h-5 px-2 bg-primary animate-pulse">
                → {folder.full_path}
              </Badge>
            )}
            {depth < 2 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-50 hover:opacity-100"
                onClick={() => { setAddingSubfolderTo(isAddingSub ? null : folder.id); setSubfolderName(""); }}
                data-testid={`button-add-subfolder-${folder.id}`}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-50 hover:opacity-100" data-testid={`button-move-folder-${folder.id}`}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {folder.parent_name && (
                  <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground pb-0">
                    In: {folder.parent_name}
                  </DropdownMenuLabel>
                )}
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {folder.parent && (
                  <DropdownMenuItem onClick={() => handleMoveFolder(folder.id, null)}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5 text-muted-foreground" />Root (top level)
                  </DropdownMenuItem>
                )}
                {flatFolders?.filter((f: any) => {
                  const excludeIds = [folder.id, folder.parent, ...getDescendantIds(folder)].filter(Boolean);
                  return !excludeIds.includes(f.id);
                }).map((f: any) => (
                  <DropdownMenuItem key={f.id} onClick={() => handleMoveFolder(folder.id, f.id)}>
                    <span style={{ paddingLeft: f.depth * 12 }}>{f.depth > 0 ? "└ " : ""}{f.name}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteFolder(folder.id)}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isAddingSub && (
            <div className="flex items-center gap-2 mt-2" style={{ paddingLeft: depth * 24 + 40 }}>
              <Input
                placeholder={depth === 0 ? "Property address..." : "Subfolder name..."}
                value={subfolderName}
                onChange={(e) => setSubfolderName(e.target.value)}
                className="h-7 w-48 text-xs"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(folder.id); if (e.key === 'Escape') setAddingSubfolderTo(null); }}
                data-testid={`input-subfolder-${folder.id}`}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleCreateGroup(folder.id)}>
                <Plus className="h-3 w-3 mr-1" />Add
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingSubfolderTo(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
      {!isCollapsed && (
        <>
          {children.map((child: any) => (
            <FolderTreeSection
              key={child.id}
              folder={child}
              depth={depth + 1}
              docsByFolder={docsByFolder}
              collapsedGroups={collapsedGroups}
              toggleGroupCollapse={toggleGroupCollapse}
              addingSubfolderTo={addingSubfolderTo}
              setAddingSubfolderTo={setAddingSubfolderTo}
              subfolderName={subfolderName}
              setSubfolderName={setSubfolderName}
              handleCreateGroup={handleCreateGroup}
              handleDeleteFolder={handleDeleteFolder}
              handleMoveFolder={handleMoveFolder}
              countDocsInTree={countDocsInTree}
              dragOverFolderId={dragOverFolderId}
              {...fileRowProps}
            />
          ))}
          {(folder.combined_analyses || []).map((ca: any) => (
            <CombinedAnalysisRow
              key={`ca-${ca.id}`}
              record={ca}
              expandedCombinedAnalyses={fileRowProps.expandedCombinedAnalyses}
              toggleCombinedExpanded={fileRowProps.toggleCombinedExpanded}
              handleDeleteCombinedAnalysis={fileRowProps.handleDeleteCombinedAnalysis}
            />
          ))}
          {docs.map((file: any) => (
            <FileRow key={file.id} file={file} depth={depth} {...fileRowProps} />
          ))}
        </>
      )}
    </React.Fragment>
  );
}

function CombinedAnalysisRow({ record, expandedCombinedAnalyses, toggleCombinedExpanded, handleDeleteCombinedAnalysis }: any) {
  const isExpanded = expandedCombinedAnalyses?.has(record.id);
  const ca = record.combined_analysis || {};
  const address = [ca.addressNumber, ca.streetName, ca.suffix].filter(Boolean).join(' ');
  const location = [address, ca.city, ca.zipcode].filter(Boolean).join(', ');
  const sources: any[] = ca.sources || record.source_document_names?.map((d: any) => ({ fileName: d.name })) || [];

  return (
    <React.Fragment>
      <TableRow className={cn("bg-indigo-500/5 hover:bg-indigo-500/10 border-l-2 border-l-indigo-400", isExpanded && "border-b-0")}>
        <TableCell>
          <Layers className="h-4 w-4 text-indigo-400 mx-auto" />
        </TableCell>
        <TableCell className="font-medium" colSpan={2}>
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-indigo-600">Combined Analysis</span>
              {location && <span className="text-[10px] text-muted-foreground leading-tight">{location}</span>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px] bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-full"
              onClick={() => toggleCombinedExpanded(record.id)}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Sparkles className="h-3 w-3" />View
            </Button>
          </div>
        </TableCell>
        <TableCell colSpan={3}>
          <div className="flex flex-wrap gap-1">
            {sources.map((s: any, i: number) => (
              <Badge key={i} variant="secondary" className="text-[10px] bg-indigo-500/10 text-indigo-600 border-indigo-500/20">
                {s.document_type || s.fileName || `Doc ${i + 1}`}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{ca.inspection_date || '--'}</TableCell>
        <TableCell></TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => handleDeleteCombinedAnalysis(record.id)}
            title="Delete combined analysis"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-indigo-500/5 hover:bg-indigo-500/5">
          <TableCell colSpan={9} className="p-0">
            <div className="px-6 py-4 max-h-[500px] overflow-auto space-y-3">
              <AnalysisReport analysis={ca} />
              {ca.conflict_notes && (
                <div className="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-700">
                  <span className="font-semibold">Conflict notes: </span>{ca.conflict_notes}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

function FileRow({ file, getFileIcon, user, decrementRateLimit, setSelectedFile, editingFileId, setEditingFileId, tempFileName, setTempFileName, handleRenameFile, handleAddTag, handleRemoveTag, flatFolders, handleMoveToFolder, handleAnalyze, isAnalyzing, selectedFile, rateLimitRemaining, expandedAnalysis, toggleAnalysisExpanded, teams, handleChangeTeam, handleTogglePrivate, handleToggleFavorite, expandedNotes, toggleNotesExpanded, handleSaveNote, userCredits = 0, depth = 0, selectedDocIds, toggleDocSelection }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.id });
  const [newTag, setNewTag] = useState("");
  const [noteText, setNoteText] = useState(file.notes || "");
  const [noteSaved, setNoteSaved] = useState(false);
  const isEditing = editingFileId === file.id;
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const isExpanded = expandedAnalysis?.has(file.id);
  const isNotesExpanded = expandedNotes?.has(file.id);
  const hasAnalysis = file.ai_analysis && typeof file.ai_analysis === 'object' && !file.ai_analysis.raw_response;

  const saveNote = async () => {
    await handleSaveNote(file.id, noteText);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  return (
    <React.Fragment>
      <TableRow ref={setNodeRef} style={style} className={cn(isDragging && "bg-muted/20", (isExpanded || isNotesExpanded) && "border-b-0", selectedDocIds?.has(file.id) && "bg-indigo-500/5")}>
        <TableCell>
          <div className="flex items-center gap-0.5">
            <input
              type="checkbox"
              checked={selectedDocIds?.has(file.id) ?? false}
              onChange={() => toggleDocSelection?.(file.id)}
              className="h-3.5 w-3.5 cursor-pointer accent-indigo-600"
              title="Select for combined analysis"
            />
            <div {...attributes} {...listeners} className="cursor-grab p-1 hover:bg-muted rounded">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </TableCell>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2" style={{ paddingLeft: (depth + 1) * 24 }}>
            {getFileIcon(file.file_type)}
            {isEditing ? (
              <Input value={tempFileName} onChange={(e) => setTempFileName(e.target.value)} className="h-7 w-32" autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleRenameFile(file.id)} />
            ) : (
              <div className="flex flex-col">
                <span className="cursor-pointer hover:underline" onClick={() => { setEditingFileId(file.id); setTempFileName(file.name); }}>
                  {file.name}
                </span>
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
            )}
            {file.is_private && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 h-5 rounded-full border border-orange-400/40 bg-orange-500/10 text-orange-500">
                <Lock className="h-2.5 w-2.5" />Private
              </span>
            )}
            {hasAnalysis && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] bg-green-500/10 text-green-600 hover:bg-green-500/20 border border-green-500/20 rounded-full"
                onClick={() => toggleAnalysisExpanded(file.id)} data-testid={`toggle-analysis-${file.id}`}>
                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <Sparkles className="h-3 w-3" />Analyzed
              </Button>
            )}
            {file.notes && (
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px] bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 border border-yellow-500/20 rounded-full"
                onClick={() => toggleNotesExpanded(file.id)}>
                <StickyNote className="h-3 w-3" />Note
              </Button>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1 items-center">
            {(file.tags || []).map((t: any) => (
              <Badge key={t.id || t.name} variant="secondary" className="text-[10px] gap-1 px-1.5 h-5">
                {t.name}<X className="h-2 w-2 cursor-pointer" onClick={() => handleRemoveTag(file.id, t.name)} />
              </Badge>
            ))}
            <div className="flex items-center gap-1">
              <Input placeholder="Tag..." value={newTag} onChange={(e) => setNewTag(e.target.value)} className="h-5 w-16 text-[10px] px-1"
                onKeyDown={(e) => { if (e.key === 'Enter') { handleAddTag(file.id, newTag); setNewTag(""); } }} />
              <Tag className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.owner_name === user?.username ? "You" : file.owner_name}</TableCell>
        <TableCell>
          {file.ai_score ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">{file.ai_score}%</Badge> : "--"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.city || "--"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.county || "--"}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-xs">{file.folder_name || "None"}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleMoveToFolder(file.id, null)}>None</DropdownMenuItem>
              {flatFolders?.map((f: any) => (
                <DropdownMenuItem key={f.id} onClick={() => handleMoveToFolder(file.id, f.id)}>
                  <span style={{ paddingLeft: f.depth * 12 }}>{f.depth > 0 ? "└ " : ""}{f.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className={`h-8 w-8 ${isNotesExpanded ? 'text-yellow-500' : ''}`} onClick={() => toggleNotesExpanded(file.id)} title="Notes" data-testid={`button-notes-${file.id}`}>
              <StickyNote className={`h-4 w-4 ${isNotesExpanded || file.notes ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleToggleFavorite(file.id)} title={file.is_favorited ? 'Unfavorite' : 'Favorite'} data-testid={`button-favorite-${file.id}`}>
              <Star className={`h-4 w-4 ${file.is_favorited ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            </Button>
            <Button variant="ghost" size="sm" className={`h-8 gap-1 ${userCredits <= 0 ? 'text-muted-foreground' : 'text-primary'}`} onClick={() => handleAnalyze(file)} disabled={isAnalyzing || rateLimitRemaining <= 0 || userCredits <= 0} data-testid={`button-analyze-${file.id}`} title={userCredits <= 0 ? 'No credits remaining' : undefined}>
              {isAnalyzing && selectedFile?.id === file.id ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /><span className="hidden md:inline">Analyzing...</span></>
              ) : (
                <><Sparkles className="h-4 w-4" /><span className="hidden md:inline">{hasAnalysis ? "Re-analyze" : "Analyze"}</span></>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem><Download className="mr-2 h-4 w-4" />Download</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleTogglePrivate(file.id, file.is_private)}>
                  {file.is_private
                    ? <><Users className="mr-2 h-4 w-4" />Share with team</>
                    : <><EyeOff className="mr-2 h-4 w-4" />Hide from team</>}
                </DropdownMenuItem>
                {(() => {
                  const availableTeams = user?.role === 'admin' ? teams : teams.filter((t: any) => t.id === user?.team);
                  if (availableTeams.length === 0) return null;
                  return (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Users className="mr-2 h-4 w-4" />Change Team
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {file.team !== null && (
                          <DropdownMenuItem onClick={() => handleChangeTeam(file.id, null)}>No Team</DropdownMenuItem>
                        )}
                        {availableTeams.filter((t: any) => t.id !== file.team).map((t: any) => (
                          <DropdownMenuItem key={t.id} onClick={() => handleChangeTeam(file.id, t.id)}>{t.name}</DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                })()}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={async () => {
                  await apiFetch(`/api/documents/${file.id}/`, { method: 'DELETE' });
                  window.location.reload();
                }}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && hasAnalysis && (
        <TableRow className={cn("bg-muted/30 hover:bg-muted/40", isNotesExpanded && "border-b-0")}>
          <TableCell colSpan={9} className="p-0">
            <div className="px-6 py-4 max-h-[500px] overflow-auto">
              <AnalysisReport analysis={file.ai_analysis} />
            </div>
          </TableCell>
        </TableRow>
      )}
      {isNotesExpanded && (
        <TableRow className="bg-yellow-500/5 hover:bg-yellow-500/10">
          <TableCell colSpan={9} className="px-6 py-3">
            <div className="flex items-start gap-3">
              <StickyNote className="h-4 w-4 text-yellow-500 mt-2 shrink-0" />
              <div className="flex-1 space-y-2">
                <textarea
                  className="w-full min-h-[80px] resize-y rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Write a note about this file..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveNote}>
                    {noteSaved ? <><Check className="mr-1 h-3 w-3 text-green-500" />Saved</> : 'Save Note'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">⌘Enter to save</span>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

function formatSectionAsText(title: string, data: any): string {
  const lines: string[] = [`${title}`];
  if (title === "Additional Notes" && typeof data === 'object') {
    for (const [area, findings] of Object.entries(data)) {
      lines.push(`${area}:`);
      if (typeof findings === 'string') {
        lines.push(`  ${findings}`);
      } else if (typeof findings === 'object' && findings !== null) {
        for (const [k, v] of Object.entries(findings as any)) {
          lines.push(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
        }
      }
    }
    return lines.join('\n');
  }
  if (data.condition) lines.push(`Condition: ${data.condition}`);
  if (data.age) lines.push(`Age: ${data.age}`);
  if (data.end_of_life) lines.push(`End of Life: ${data.end_of_life}`);
  if (data.issues?.length) { lines.push('Issues:'); data.issues.forEach((i: string) => lines.push(`  • ${i}`)); }
  if (data.recommendation) lines.push(`Recommendation: ${data.recommendation}`);
  if (data.recommendations) lines.push(`Recommendations: ${data.recommendations}`);
  if (data.notes) lines.push(`Notes: ${data.notes}`);
  return lines.join('\n');
}

function formatAnalysisAsText(analysis: any): string {
  const summary = analysis.summary || {};
  const lines: string[] = ['=== Property Information ==='];
  if (analysis.document_type) lines.push(`Type: ${analysis.document_type}`);
  if (analysis.addressNumber) lines.push(`Address: ${analysis.addressNumber} ${analysis.streetName} ${analysis.suffix}`);
  if (analysis.city) lines.push(`City: ${analysis.city}`);
  if (analysis.county) lines.push(`County: ${analysis.county}`);
  if (analysis.zipcode) lines.push(`Zipcode: ${analysis.zipcode}`);
  if (analysis.fileName) lines.push(`File: ${analysis.fileName}`);
  lines.push('', '=== Inspection Summary ===');
  const allSections = ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC", "Permits", "Pest Inspection", "Additional Notes"];
  for (const section of allSections) {
    if (summary[section]) {
      lines.push('', `--- ${section} ---`);
      lines.push(formatSectionAsText(section, summary[section]).split('\n').slice(1).join('\n'));
    }
  }
  return lines.join('\n');
}

function CopyButton({ getText, className = "" }: { getText: () => string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="icon" className={`h-6 w-6 ${className}`} onClick={handleCopy} title="Copy to clipboard">
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function InspectionSection({ title, data }: { title: string; data: any }) {
  if (!data) return null;

  if (title === "Additional Notes" && typeof data === 'object') {
    return (
      <div className="space-y-2" data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="flex items-center gap-1">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
        </div>
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
    <div className="space-y-1.5 rounded-lg border p-3 bg-card" data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-primary">{title}</h4>
        <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
      </div>
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
    <div className="space-y-4" data-testid="analysis-report">
      <div className="rounded-lg border bg-primary/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Property Information</h3>
          <div className="flex items-center gap-2">
            {analysis.document_type && <Badge variant="secondary" className="text-[10px]">{analysis.document_type}</Badge>}
            <CopyButton getText={() => formatAnalysisAsText(analysis)} />
          </div>
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
