import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/mock-auth";
import { usePrivacyMode, maskAnalysis } from "@/lib/privacy-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileIcon, UploadCloud, RefreshCw, Search, MoreHorizontal,
  FileText, FileImage, FileCode, Download, Users, Sparkles,
  ArrowUpDown, LayoutDashboard, FolderOpen, GripVertical, Plus, Minus, ChevronRight, ChevronDown, Tag, X, FolderPlus, Folder, Trash2,
  EyeOff, Lock, Coins, Copy, Check, Star, StickyNote, Layers, Mail, Share2, Pencil, Archive, ArchiveRestore, UserPlus, Languages, FileDown
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

function updateCombinedFavoriteInChildren(children: any[], recordId: number, is_favorited: boolean): any[] {
  return children.map(c => ({
    ...c,
    combined_analyses: (c.combined_analyses || []).map((ca: any) =>
      ca.id === recordId ? { ...ca, is_favorited } : ca
    ),
    children: updateCombinedFavoriteInChildren(c.children || [], recordId, is_favorited),
  }));
}

export default function DashboardPage({ initialFavoritesOnly = false, initialActiveTab }: { initialFavoritesOnly?: boolean; initialActiveTab?: string } = {}) {
  const { user, refreshUser, decrementRateLimit, rateLimitRemaining, resetRateLimit } = useAuth();
  const { privacyMode } = usePrivacyMode();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [archivedFolders, setArchivedFolders] = useState<any[]>([]);
  const [teams, setTeams] = useState<{id: number, name: string}[]>([]);
  const [activeTab, setActiveTab] = useState(initialActiveTab ?? "my-files");
  const [isUploading, setIsUploading] = useState(false);
  const [isScreening, setIsScreening] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadCurrent, setUploadCurrent] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadPrivate, setUploadPrivate] = useState(false);
  const [uploadDestType, setUploadDestType] = useState<'existing' | 'new'>('new');
  const [uploadDestFolderId, setUploadDestFolderId] = useState<number | null>(null);
  const [uploadDestNewName, setUploadDestNewName] = useState('');
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pendingAnalyzeFile, setPendingAnalyzeFile] = useState<any>(null);
  const [groupBy, setGroupBy] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [editingFileId, setEditingFileId] = useState<number | null>(null);
  const [tempFileName, setTempFileName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('dashboard_collapsed_groups');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const foldersInitialized = useRef(!!sessionStorage.getItem('dashboard_folders_initialized'));
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<number>>(new Set());
  const [addingSubfolderTo, setAddingSubfolderTo] = useState<number | null>(null);
  const [subfolderName, setSubfolderName] = useState("");
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);
  const [myCreditRequest, setMyCreditRequest] = useState<any | null>(undefined);
  const [creditRequestAmount, setCreditRequestAmount] = useState(5);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(initialFavoritesOnly);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set());
  const [isCombining, setIsCombining] = useState(false);
  const [expandedCombinedAnalyses, setExpandedCombinedAnalyses] = useState<Set<number>>(new Set());
  const [isDraftingEmail, setIsDraftingEmail] = useState(false);
  const [draftEmailDocId, setDraftEmailDocId] = useState<number | null>(null);
  const [sharedDocs, setSharedDocs] = useState<any[]>([]);
  const [shareWithUserDocId, setShareWithUserDocId] = useState<number | null>(null);
  const [allUsers, setAllUsers] = useState<{id: number, username: string}[]>([]);
  const [shareUserSearch, setShareUserSearch] = useState("");

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
    const [docsRes, foldersRes, archivedRes, sharedRes] = await Promise.all([
      apiFetch(`/api/documents/?scope=${scope}&days=7`),
      apiFetch('/api/folders/'),
      apiFetch('/api/folders/?archived=true'),
      apiFetch('/api/documents/shared_with_me/'),
    ]);
    if (docsRes.ok) setDocuments(await docsRes.json());
    if (foldersRes.ok) {
      const loadedFolders = await foldersRes.json();
      setFolders(loadedFolders);
    }
    if (archivedRes.ok) setArchivedFolders(await archivedRes.json());
    if (sharedRes.ok) setSharedDocs(await sharedRes.json());
  };

  useEffect(() => { loadData(); }, [activeTab]);

  useEffect(() => {
    if (folders.length > 0 && !foldersInitialized.current) {
      foldersInitialized.current = true;
      sessionStorage.setItem('dashboard_folders_initialized', 'true');
      const initial = new Set([
        ...getAllFolderIds(folders).map((id: number) => `folder-${id}`),
        'unassigned',
      ]);
      setCollapsedGroups(initial);
      sessionStorage.setItem('dashboard_collapsed_groups', JSON.stringify(Array.from(initial)));
    }
  }, [folders]);

  useEffect(() => {
    if (foldersInitialized.current) {
      sessionStorage.setItem('dashboard_collapsed_groups', JSON.stringify(Array.from(collapsedGroups)));
    }
  }, [collapsedGroups]);

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
        setFolderPopoverOpen(false);
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

  const doAnalyze = async (fileToAnalyze: any) => {
    if (!decrementRateLimit()) return;
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

  const handleAnalyze = async (targetFile?: any) => {
    const fileToAnalyze = targetFile || selectedFile;
    if (!fileToAnalyze) return;
    if ((user?.credits ?? 0) < 1) {
      toast({ title: "No credits remaining", description: "Request more credits on the Teams page.", variant: "destructive" });
      return;
    }
    try {
      const costRes = await apiFetch(`/api/documents/${fileToAnalyze.id}/analyze-cost/`);
      const { credits_required } = await costRes.json();
      if (credits_required > 1) {
        setPendingAnalyzeFile({ ...fileToAnalyze, credits_required });
        return;
      }
    } catch {
      // If cost check fails, proceed normally
    }
    await doAnalyze(fileToAnalyze);
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

  const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt']);

  const filterByType = (files: File[]): { allowed: File[]; rejected: string[] } => {
    const allowed: File[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        allowed.push(f);
      } else {
        rejected.push(f.name);
      }
    }
    return { allowed, rejected };
  };

  const uploadFiles = async (files: File[], isPrivate: boolean, overrideFolderId?: number | null) => {
    setIsUploading(true);
    setUploadTotal(files.length);

    const foldersRes = await apiFetch('/api/folders/');
    let currentFolders = foldersRes.ok ? await foldersRes.json() : folders;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadCurrent(i + 1);
      setUploadProgress(0);

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
        if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status}`);

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

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Document creation failed (${res.status})`);
        }

        const newDoc = await res.json();

        if (overrideFolderId != null) {
          await apiFetch(`/api/documents/${newDoc.id}/move/`, {
            method: 'POST',
            body: JSON.stringify({ folder_id: overrideFolderId }),
          });
        } else {
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
              currentFolders = [...currentFolders, newFolder];
              await apiFetch(`/api/documents/${newDoc.id}/move/`, {
                method: 'POST',
                body: JSON.stringify({ folder_id: newFolder.id }),
              });
            }
          }
        }

        setUploadProgress(100);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Upload failed for ${file.name}:`, err);
        toast({ title: `Failed to upload "${file.name}"`, description: msg, variant: 'destructive' });
      }
    }

    loadData();
    setTimeout(() => {
      setIsUploading(false);
      setUploadTotal(0);
      setUploadCurrent(0);
    }, 500);
  };

  const handleUpload = async (isPrivate = false, folderMode = false) => {
    if (!decrementRateLimit()) return;

    // Resolve destination folder before opening file picker
    let resolvedFolderId: number | null | undefined = undefined;
    if (uploadDestType === 'existing' && uploadDestFolderId != null) {
      resolvedFolderId = uploadDestFolderId;
    } else if (uploadDestType === 'new' && uploadDestNewName.trim()) {
      const trimmed = uploadDestNewName.trim();
      const existingMatch = flatFolders.find(f => f.name.toLowerCase() === trimmed.toLowerCase());
      if (existingMatch) {
        resolvedFolderId = existingMatch.id;
      } else {
        const folderRes = await apiFetch('/api/folders/', {
          method: 'POST',
          body: JSON.stringify({ name: trimmed }),
        });
        if (folderRes.ok) {
          const newFolder = await folderRes.json();
          resolvedFolderId = newFolder.id;
          setFolders(prev => [...prev, newFolder]);
        }
      }
    }

    setShowUploadDialog(false);
    setUploadDestType('new');
    setUploadDestFolderId(null);
    setUploadDestNewName('');
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folderMode) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.onchange = async (e: any) => {
      const raw: File[] = Array.from(e.target.files || []);
      if (raw.length === 0) return;

      // Step 1: filter to PDF and TXT only
      const { allowed, rejected } = filterByType(raw);
      if (rejected.length > 0) {
        toast({
          title: `${rejected.length} file${rejected.length > 1 ? 's' : ''} skipped`,
          description: `Only PDF and TXT files are supported. Skipped: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ` and ${rejected.length - 3} more` : ''}.`,
        });
      }
      if (allowed.length === 0) return;

      // Step 2: AI screening (skip for single file uploads)
      let toUpload: File[] = [];
      if (allowed.length === 1) {
        toUpload = allowed;
      } else {
        setIsScreening(true);
        try {
          const screenRes = await apiFetch('/api/screen-files/', {
            method: 'POST',
            body: JSON.stringify({ file_names: allowed.map(f => f.name) }),
          });
          if (!screenRes.ok) {
            const err = await screenRes.json().catch(() => ({}));
            throw new Error(err.error || `Screening failed (${screenRes.status})`);
          }
          const { approved } = await screenRes.json() as { approved: string[] };
          const approvedSet = new Set(approved.map((n: string) => n.toLowerCase()));
          toUpload = allowed.filter(f => approvedSet.has(f.name.toLowerCase()));
          const skipped = allowed.length - toUpload.length;
          toast({
            title: toUpload.length === 0
              ? 'No files approved'
              : `AI approved ${toUpload.length} of ${allowed.length} file${allowed.length > 1 ? 's' : ''}`,
            description: skipped > 0
              ? `${skipped} file${skipped > 1 ? 's were' : ' was'} filtered out as not property-related.`
              : 'All files passed screening.',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          toast({ title: 'Screening failed', description: msg, variant: 'destructive' });
          setIsScreening(false);
          return;
        } finally {
          setIsScreening(false);
        }
      }

      if (toUpload.length === 0) return;
      await uploadFiles(toUpload, isPrivate, resolvedFolderId);
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

  const handleArchiveFolder = async (folderId: number) => {
    const res = await apiFetch(`/api/folders/${folderId}/toggle_archive/`, { method: 'POST' });
    if (res.ok) loadData();
  };

  const handleMoveFolder = async (folderId: number, newParentId: number | null) => {
    const res = await apiFetch(`/api/folders/${folderId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ parent: newParentId === null ? '' : newParentId }),
    });
    if (res.ok) loadData();
  };

  const handleRenameFolder = async (folderId: number, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const res = await apiFetch(`/api/folders/${folderId}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
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

  const handleDraftEmail = async (docId: number) => {
    setIsDraftingEmail(true);
    setDraftEmailDocId(docId);
    const res = await apiFetch(`/api/documents/${docId}/draft-email/`, { method: 'POST' });
    if (res.ok) {
      const { email_draft } = await res.json();
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, email_draft } : d));
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Could not draft email", description: err.error, variant: "destructive" });
    }
    setIsDraftingEmail(false);
    setDraftEmailDocId(null);
  };

  const handleToggleFavorite = async (docId: number) => {
    const res = await apiFetch(`/api/documents/${docId}/toggle_favorite/`, { method: 'POST' });
    if (res.ok) {
      const { is_favorited } = await res.json();
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, is_favorited } : d));
    }
  };

  const handleToggleFolderFavorite = async (folderId: number) => {
    const res = await apiFetch(`/api/folders/${folderId}/toggle_favorite/`, { method: 'POST' });
    if (res.ok) {
      const { is_favorited } = await res.json();

      // Find the folder and all descendant folder IDs
      const findFolder = (list: any[]): any => {
        for (const f of list) {
          if (f.id === folderId) return f;
          const found = findFolder(f.children || []);
          if (found) return found;
        }
        return null;
      };
      const targetFolder = findFolder(folders);
      const allFolderIds = targetFolder ? [folderId, ...getDescendantIds(targetFolder)] : [folderId];

      // Favorite/unfavorite all docs in those folders
      const affectedDocIds = documents
        .filter(d => d.folder != null && allFolderIds.includes(d.folder))
        .map(d => d.id);

      await Promise.all(
        affectedDocIds
          .filter(id => {
            const doc = documents.find(d => d.id === id);
            return doc && doc.is_favorited !== is_favorited;
          })
          .map(id => apiFetch(`/api/documents/${id}/toggle_favorite/`, { method: 'POST' }))
      );

      // Update local state
      const updateTree = (list: any[]): any[] => list.map(f =>
        f.id === folderId
          ? { ...f, is_favorited }
          : { ...f, children: updateTree(f.children || []) }
      );
      setFolders(prev => updateTree(prev));
      setDocuments(prev => prev.map(d =>
        allFolderIds.includes(d.folder) ? { ...d, is_favorited } : d
      ));
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

  const openShareWithUser = async (docId: number) => {
    setShareWithUserDocId(docId);
    if (allUsers.length === 0) {
      const res = await apiFetch('/api/admin/users/');
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.map((u: any) => ({ id: u.id, username: u.username })));
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

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedDocIds);
    if (ids.length === 0) return;
    const results = await Promise.all(
      ids.map(id => apiFetch(`/api/documents/${id}/`, { method: 'DELETE' }))
    );
    const succeeded = ids.filter((_, i) => results[i].ok);
    if (succeeded.length > 0) {
      setSelectedDocIds(new Set());
      setDocuments(prev => prev.filter(d => !succeeded.includes(d.id)));
      loadData();
    }
    if (succeeded.length < ids.length) {
      toast({ title: "Some files could not be deleted", description: "Please try again.", variant: "destructive" });
    }
  };

  const [combineStatus, setCombineStatus] = useState("");

  const handleCombineAnalysis = async () => {
    const ids = Array.from(selectedDocIds);
    if (ids.length < 2) return;

    const selected = documents.filter(d => ids.includes(d.id));
    const folderIds = Array.from(new Set(selected.map((d: any) => d.folder).filter(Boolean)));
    if (folderIds.length !== 1) {
      toast({ title: "Select documents from the same folder", description: "All selected documents must be in the same folder.", variant: "destructive" });
      return;
    }

    const needsAnalysis = selected.filter((d: any) => !d.ai_analysis || d.ai_analysis.raw_response !== undefined || !d.ai_analysis.summary);
    const creditsNeeded = needsAnalysis.length + 1;
    if ((user?.credits ?? 0) < creditsNeeded) {
      toast({
        title: "Not enough credits",
        description: `This will use ${creditsNeeded} credit${creditsNeeded > 1 ? 's' : ''} (${needsAnalysis.length} for analysis + 1 for combining). You have ${user?.credits ?? 0}.`,
        variant: "destructive",
      });
      return;
    }

    setIsCombining(true);
    try {
      // Analyze any docs that are missing analysis first
      let updatedDocs = [...documents];
      for (let i = 0; i < needsAnalysis.length; i++) {
        const doc = needsAnalysis[i];
        setCombineStatus(`Analyzing "${doc.name}" (${i + 1}/${needsAnalysis.length})...`);
        const res = await apiFetch(`/api/documents/${doc.id}/analyze/`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (res.status === 402) {
          toast({ title: "No credits remaining", description: "Ran out of credits during analysis.", variant: "destructive" });
          await refreshUser();
          return;
        }
        if (!res.ok) {
          toast({ title: `Failed to analyze "${doc.name}"`, description: "Please try again.", variant: "destructive" });
          return;
        }
        const updated = await res.json();
        updatedDocs = updatedDocs.map(d => d.id === updated.id ? updated : d);
        setDocuments(updatedDocs);
        await refreshUser();
      }

      setCombineStatus("Combining analyses...");
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
      setCombineStatus("");
    }
  };

  const handleToggleCombinedFavorite = async (recordId: number) => {
    const res = await apiFetch(`/api/combined-analyses/${recordId}/toggle_favorite/`, { method: 'POST' });
    if (res.ok) {
      const { is_favorited } = await res.json();
      setFolders(prev => prev.map(f => ({
        ...f,
        combined_analyses: (f.combined_analyses || []).map((ca: any) =>
          ca.id === recordId ? { ...ca, is_favorited } : ca
        ),
        children: updateCombinedFavoriteInChildren(f.children || [], recordId, is_favorited),
      })));
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
    const allArchivedIds = new Set(getAllFolderIds(archivedFolders));
    let docs = documents.filter(d => {
      if (d.folder && allArchivedIds.has(d.folder)) return false;
      return true;
    });
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
    } else {
      docs = [...docs].sort((a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    return docs.map(d => ({ ...d, ai_analysis: maskAnalysis(d.ai_analysis, privacyMode) }));
  }, [documents, archivedFolders, searchQuery, sortConfig, showFavoritesOnly, privacyMode]);

  const filteredFolders = useMemo(() => {
    let result = [...folders];
    if (showFavoritesOnly) {
      const isFavoritedInTree = (folder: any): boolean =>
        folder.is_favorited || (folder.children || []).some(isFavoritedInTree);
      result = result.filter(isFavoritedInTree);
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [folders, showFavoritesOnly]);

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

  const docsByArchivedFolder = useMemo(() => {
    const map: Record<number, any[]> = {};
    const allArchivedIds = getAllFolderIds(archivedFolders);
    allArchivedIds.forEach(id => { map[id] = []; });
    documents.forEach(d => {
      if (d.folder && map[d.folder] !== undefined) {
        map[d.folder].push(d);
      }
    });
    return map;
  }, [documents, archivedFolders]);

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
    expandedCombinedAnalyses, toggleCombinedExpanded, handleDeleteCombinedAnalysis, handleToggleCombinedFavorite,
    handleDraftEmail, isDraftingEmail, draftEmailDocId,
  };

  const countDocsInTree = (folder: any): number => {
    let count = (docsByFolder[folder.id] || []).length;
    if (folder.children) {
      folder.children.forEach((c: any) => { count += countDocsInTree(c); });
    }
    return count;
  };

  const getDocIdsInTree = (folder: any): number[] => {
    const ids = (docsByFolder[folder.id] || []).map((d: any) => d.id);
    if (folder.children) folder.children.forEach((c: any) => ids.push(...getDocIdsInTree(c)));
    return ids;
  };

  const selectAllInFolder = (folder: any) => {
    const ids = getDocIdsInTree(folder);
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.length > 0 && ids.every(id => next.has(id));
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const countDocsInArchivedTree = (folder: any): number => {
    let count = (docsByArchivedFolder[folder.id] || []).length;
    if (folder.children) {
      folder.children.forEach((c: any) => { count += countDocsInArchivedTree(c); });
    }
    return count;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight">{initialFavoritesOnly ? "Favorites" : activeTab === "archive" ? "Archive" : activeTab === "shared-with-me" ? "Shared with me" : "Dashboard"}</h2>
          <p className="text-muted-foreground">
            {initialFavoritesOnly ? "Your starred documents." : "Manage, group, and analyze your files."}
            {!initialFavoritesOnly && <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">Last 7 days</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreditsDialog(true)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-opacity hover:opacity-80 ${(user?.credits ?? 0) === 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : (user?.credits ?? 0) <= 2 ? 'border-orange-400/40 bg-orange-500/10 text-orange-500' : 'border-primary/30 bg-primary/5 text-primary'}`}
          >
            <Coins className="h-3.5 w-3.5" />
            {user?.credits ?? 0} {(user?.credits ?? 0) === 1 ? 'credit' : 'credits'} left
          </button>
<Button onClick={() => { setUploadPrivate(false); setShowUploadDialog(true); }} disabled={isUploading || isScreening || rateLimitRemaining <= 0} data-testid="button-upload">
            <UploadCloud className="mr-2 h-4 w-4" />{isScreening ? "Screening..." : isUploading ? "Uploading..." : "Upload Files"}
          </Button>
        </div>
      </div>

      {(isScreening || isUploading) && (
        <Card className="border-primary/20 bg-primary/5"><CardContent className="pt-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">
              {isScreening ? "Screening files with AI..." : uploadTotal > 1 ? `Uploading file ${uploadCurrent} of ${uploadTotal}...` : "Uploading..."}
            </span>
            {isUploading && !isScreening && <span>{uploadProgress}%</span>}
          </div>
          {isScreening
            ? <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20"><div className="absolute h-full bg-primary animate-pulse w-1/2 rounded-full" /></div>
            : <Progress value={uploadProgress} className="h-2" />}
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="my-files" className="gap-2"><FileText className="h-4 w-4" />My Files</TabsTrigger>
              <TabsTrigger value="team-files" className="gap-2"><Users className="h-4 w-4" />Team Files</TabsTrigger>
              <TabsTrigger value="archive" className="gap-2"><Archive className="h-4 w-4" />Archive</TabsTrigger>
              <TabsTrigger value="shared-with-me" className="gap-2"><UserPlus className="h-4 w-4" />Shared with me</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant={groupBy ? "secondary" : "outline"} size="sm" className="gap-2" onClick={() => setGroupBy(!groupBy)}>
            <LayoutDashboard className="h-4 w-4" />{groupBy ? "Ungroup" : "Group Files"}
          </Button>
          <Button variant={showFavoritesOnly ? "secondary" : "outline"} size="sm" className="gap-2" onClick={() => setShowFavoritesOnly(v => !v)}>
            <Star className={`h-4 w-4 ${showFavoritesOnly ? 'fill-yellow-400 text-yellow-400' : ''}`} />Favorites
          </Button>
          <Popover open={folderPopoverOpen} onOpenChange={setFolderPopoverOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-2" data-testid="button-create-folder">
                <FolderPlus className="h-4 w-4" />New Client Folder
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4 space-y-3" align="end">
              <p className="text-sm font-medium">Create a new client folder</p>
              <Input
                placeholder="e.g. Client Name or Property Address"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                className="h-8 text-xs"
                autoFocus
                data-testid="input-new-folder"
              />
              <Button size="sm" className="w-full" onClick={() => handleCreateGroup()} disabled={!newGroupName.trim()}>
                Create Folder
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search files, folders, tags, city, county, address..." className="pl-9 bg-card" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-search" />
        </div>
      </div>

      {selectedDocIds.size >= 1 && (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5">
          <Layers className="h-4 w-4 text-indigo-500 shrink-0" />
          <span className="text-sm font-medium text-indigo-600">{selectedDocIds.size} {selectedDocIds.size === 1 ? 'document' : 'documents'} selected</span>
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
              variant="outline"
              className="h-7 gap-1.5 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={handleBulkDelete}
            >
              <Trash2 className="h-3 w-3" />
              Delete {selectedDocIds.size === 1 ? 'File' : `${selectedDocIds.size} Files`}
            </Button>
            {selectedDocIds.size >= 2 && (
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={handleCombineAnalysis}
                disabled={isCombining}
              >
                {isCombining ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
                {isCombining ? (combineStatus || "Working...") : "Combine Analysis"}
              </Button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'archive' && (
        <Card className="overflow-hidden grayscale opacity-75">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Actions</TableHead>
                <TableHead>City</TableHead>
                <TableHead>County</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archivedFolders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                    <Archive className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No archived folders</p>
                  </TableCell>
                </TableRow>
              ) : (
                archivedFolders.map(folder => (
                  <FolderTreeSection
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    docsByFolder={docsByArchivedFolder}
                    collapsedGroups={collapsedGroups}
                    toggleGroupCollapse={toggleGroupCollapse}
                    addingSubfolderTo={null}
                    setAddingSubfolderTo={() => {}}
                    subfolderName=""
                    setSubfolderName={() => {}}
                    handleCreateGroup={() => {}}
                    handleDeleteFolder={handleDeleteFolder}
                    handleArchiveFolder={handleArchiveFolder}
                    handleMoveFolder={handleMoveFolder}
                    handleRenameFolder={handleRenameFolder}
                    handleToggleFolderFavorite={handleToggleFolderFavorite}
                    countDocsInTree={countDocsInArchivedTree}
                    dragOverFolderId={null}
                    showFavoritesOnly={false}
                    isArchiveView={true}
                    {...fileRowProps}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      {activeTab === 'shared-with-me' && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Shared by</TableHead>
                <TableHead>City</TableHead>
                <TableHead>County</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sharedDocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No documents have been shared with you yet.</p>
                  </TableCell>
                </TableRow>
              ) : (
                sharedDocs.map((doc: any) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{doc.name}</span>
                        {doc.ai_analysis && (
                          <span className="text-[10px] text-muted-foreground">
                            {[doc.ai_analysis.city, doc.ai_analysis.county].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{doc.owner_name || '--'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{doc.ai_analysis?.city || '--'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{doc.ai_analysis?.county || '--'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : '--'}
                    </TableCell>
                    <TableCell>
                      {doc.ai_score ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">{doc.ai_score}%</Badge> : '--'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
      {activeTab !== 'archive' && activeTab !== 'shared-with-me' && (
      <DndContext sensors={sensors} collisionDetection={customCollisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveDragId(null); setDragOverFolderId(null); }}>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>Name <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                <TableHead>Actions</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.city')}>
                  City {sortConfig?.key === 'ai_analysis.city' ? <ArrowUpDown className="inline h-3 w-3 text-primary" /> : <ArrowUpDown className="inline h-3 w-3 opacity-30" />}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_analysis.county')}>
                  County {sortConfig?.key === 'ai_analysis.county' ? <ArrowUpDown className="inline h-3 w-3 text-primary" /> : <ArrowUpDown className="inline h-3 w-3 opacity-30" />}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('owner_name')}>Owner <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('created_at')}>
                  Date {sortConfig?.key === 'created_at' ? <ArrowUpDown className="inline h-3 w-3 text-primary" /> : <ArrowUpDown className="inline h-3 w-3 opacity-30" />}
                </TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('ai_score')}>Score <ArrowUpDown className="inline h-3 w-3" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupBy ? (
                <>
                  <SortableContext items={filteredFolders.map(f => `folder-${f.id}`)} strategy={verticalListSortingStrategy}>
                    {filteredFolders.map(folder => (
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
                        handleArchiveFolder={handleArchiveFolder}
                        handleMoveFolder={handleMoveFolder}
                        handleRenameFolder={handleRenameFolder}
                        handleToggleFolderFavorite={handleToggleFolderFavorite}
                        countDocsInTree={countDocsInTree}
                        selectAllInFolder={selectAllInFolder}
                        dragOverFolderId={dragOverFolderId}
                        showFavoritesOnly={showFavoritesOnly}
                        isArchiveView={false}
                        {...fileRowProps}
                      />
                    ))}
                  </SortableContext>
                  {(docsByFolder['unassigned'] || []).length > 0 && !showFavoritesOnly && (
                    <>
                      <TableRow className="bg-muted/40 border-b-2">
                        <TableCell></TableCell>
                        <TableCell colSpan={9} className="py-2">
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
      )}

      <Dialog open={shareWithUserDocId !== null} onOpenChange={(open) => { if (!open) { setShareWithUserDocId(null); setShareUserSearch(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Share with user</DialogTitle>
            <DialogDescription>Select a user to share this document's analysis with.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search users..."
            value={shareUserSearch}
            onChange={(e) => setShareUserSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="max-h-60 overflow-y-auto space-y-1 mt-1">
            {allUsers
              .filter(u => u.username.toLowerCase().includes(shareUserSearch.toLowerCase()))
              .map(u => (
                <button
                  key={u.id}
                  className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                  onClick={async () => {
                    const res = await apiFetch(`/api/documents/${shareWithUserDocId}/share_with_user/`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ user_id: u.id }),
                    });
                    if (res.ok) {
                      toast({ title: `Shared with ${u.username}` });
                      setShareWithUserDocId(null);
                      setShareUserSearch("");
                    } else {
                      toast({ title: "Failed to share", variant: "destructive" });
                    }
                  }}
                >
                  {u.username}
                </button>
              ))}
            {allUsers.filter(u => u.username.toLowerCase().includes(shareUserSearch.toLowerCase())).length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">No users found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingAnalyzeFile} onOpenChange={(open) => { if (!open) setPendingAnalyzeFile(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Large Document
            </DialogTitle>
            <DialogDescription>
              <strong>{pendingAnalyzeFile?.name}</strong> is a larger document and will cost{' '}
              <strong>{pendingAnalyzeFile?.credits_required} credits</strong> to analyze. You currently have{' '}
              <strong>{user?.credits ?? 0} credits</strong>. Would you like to proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center sm:justify-center">
            <Button variant="outline" onClick={() => setPendingAnalyzeFile(null)}>Cancel</Button>
            <Button onClick={() => { const f = pendingAnalyzeFile; setPendingAnalyzeFile(null); doAnalyze(f); }}>
              <Sparkles className="mr-2 h-4 w-4" />Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <DialogFooter className="justify-center sm:justify-center">
            <Button variant="outline" onClick={() => setShowCreditsDialog(false)}>Close</Button>
            {myCreditRequest === null && (
              <Button onClick={handleCreditRequest}>
                <Coins className="mr-2 h-4 w-4" />Request {creditRequestAmount} Credits
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUploadDialog} onOpenChange={(open) => {
        setShowUploadDialog(open);
        if (!open) { setUploadDestType('new'); setUploadDestFolderId(null); setUploadDestNewName(''); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload Files</DialogTitle>
            <DialogDescription>Only PDF and TXT files are accepted. AI screens files before uploading.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
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
                <span className="ml-auto text-xs text-muted-foreground shrink-0">click to toggle</span>
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

            {/* Folder destination */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload destination <span className="text-destructive">*</span></p>
              <div className="flex gap-1">
                {(['new', 'existing'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => { setUploadDestType(type); setUploadDestFolderId(null); setUploadDestNewName(''); }}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${uploadDestType === type ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted/50'}`}
                  >
                    {type === 'new' ? 'New folder' : 'Existing folder'}
                  </button>
                ))}
              </div>
              {uploadDestType === 'existing' && (
                <Select value={uploadDestFolderId?.toString() ?? ''} onValueChange={v => setUploadDestFolderId(Number(v))}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select a folder..." />
                  </SelectTrigger>
                  <SelectContent>
                    {flatFolders.map(f => (
                      <SelectItem key={f.id} value={f.id.toString()}>
                        <span style={{ paddingLeft: f.depth * 12 }}>{f.depth > 0 ? '└ ' : ''}{f.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {uploadDestType === 'new' && (() => {
                const trimmed = uploadDestNewName.trim().toLowerCase();
                const existing = trimmed ? flatFolders.find(f => f.name.toLowerCase() === trimmed) : null;
                return (
                  <div className="space-y-1.5">
                    <Input
                      placeholder="e.g. Client Name or Property Address"
                      value={uploadDestNewName}
                      onChange={e => setUploadDestNewName(e.target.value)}
                      className="h-8 text-xs"
                      autoFocus
                    />
                    {existing && (
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        Folder "{existing.name}" already exists — files will be added to it instead.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {(() => {
              const folderReady = (uploadDestType === 'existing' && uploadDestFolderId != null) ||
                (uploadDestType === 'new' && uploadDestNewName.trim().length > 0);
              return (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleUpload(uploadPrivate, false)}
                    disabled={!folderReady}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${folderReady ? 'hover:bg-muted/50' : 'opacity-40 cursor-not-allowed'}`}
                  >
                    <UploadCloud className={`h-6 w-6 ${folderReady ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-sm font-medium">Choose Files</p>
                      <p className="text-xs text-muted-foreground">Select individual files</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleUpload(uploadPrivate, true)}
                    disabled={!folderReady}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${folderReady ? 'hover:bg-muted/50' : 'opacity-40 cursor-not-allowed'}`}
                  >
                    <FolderOpen className={`h-6 w-6 ${folderReady ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-sm font-medium">Upload Folder</p>
                      <p className="text-xs text-muted-foreground">Select an entire folder</p>
                    </div>
                  </button>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => setShowUploadDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderTreeSection({ folder, depth, docsByFolder, collapsedGroups, toggleGroupCollapse, addingSubfolderTo, setAddingSubfolderTo, subfolderName, setSubfolderName, handleCreateGroup, handleDeleteFolder, handleArchiveFolder, handleMoveFolder, handleRenameFolder, handleToggleFolderFavorite, countDocsInTree, selectAllInFolder, dragOverFolderId, showFavoritesOnly, isArchiveView, ...fileRowProps }: any) {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState('');
  const { flatFolders, selectedDocIds } = fileRowProps;
  const collapseKey = `folder-${folder.id}`;
  const isCollapsed = collapsedGroups.has(collapseKey);
  const docs = docsByFolder[folder.id] || [];
  const isFavoritedInTree = (f: any): boolean => f.is_favorited || (f.children || []).some(isFavoritedInTree);
  const children = showFavoritesOnly
    ? (folder.children || []).filter(isFavoritedInTree)
    : (folder.children || []);
  const totalDocs = countDocsInTree(folder);
  const isAddingSub = addingSubfolderTo === folder.id;

  const getAllIdsInTree = (f: any): number[] => {
    const ids = (docsByFolder[f.id] || []).map((d: any) => d.id);
    if (f.children) f.children.forEach((c: any) => ids.push(...getAllIdsInTree(c)));
    return ids;
  };
  const allIdsInFolder = getAllIdsInTree(folder);
  const allSelected = allIdsInFolder.length > 0 && allIdsInFolder.every(id => selectedDocIds?.has(id));
  const someSelected = !allSelected && allIdsInFolder.some(id => selectedDocIds?.has(id));

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
          <div className="flex items-center gap-1">
            {!isArchiveView && allIdsInFolder.length > 0 && (
              <input
                type="checkbox"
                className="h-3.5 w-3.5 cursor-pointer"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected; }}
                onChange={() => selectAllInFolder?.(folder)}
                title="Select all files in folder"
              />
            )}
            {isRoot && (
              <div {...attributes} {...listeners} className="cursor-grab p-1 hover:bg-muted rounded">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        </TableCell>
        <TableCell colSpan={9} className="py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 }}>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleGroupCollapse(collapseKey)}>
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {folderIcon}
            {isRenaming ? (
              <Input
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { handleRenameFolder(folder.id, renameValue); setIsRenaming(false); }
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                onBlur={() => { if (renameValue.trim()) handleRenameFolder(folder.id, renameValue); setIsRenaming(false); }}
                className="h-6 w-40 text-xs font-bold"
                autoFocus
              />
            ) : (
              <span className={cn("font-bold text-xs uppercase tracking-tight", depth === 0 && "text-sm")}>{folder.name}</span>
            )}
            <Badge variant="outline" className="text-[10px] h-4">{totalDocs}</Badge>
            {isDragTarget && (
              <Badge variant="default" className="text-[10px] h-5 px-2 bg-primary animate-pulse">
                → {folder.full_path}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-50 hover:opacity-100"
              onClick={() => handleToggleFolderFavorite(folder.id)}
              title={folder.is_favorited ? 'Unfavorite' : 'Favorite'}
            >
              <Star className={`h-3.5 w-3.5 ${folder.is_favorited ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            </Button>
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
                {!isArchiveView && (
                  <DropdownMenuItem onClick={() => { setRenameValue(folder.name); setIsRenaming(true); }}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />Rename folder
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleArchiveFolder(folder.id)}>
                  {isArchiveView
                    ? <><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Unarchive folder</>
                    : <><Archive className="mr-2 h-3.5 w-3.5" />Archive folder</>
                  }
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteFolder(folder.id)}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {isAddingSub && (
            <div className="flex items-center gap-2 mt-2" style={{ paddingLeft: depth * 24 + 40 }}>
              <Input
                placeholder="e.g. Client Name or Property Address"
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
              handleArchiveFolder={handleArchiveFolder}
              handleMoveFolder={handleMoveFolder}
              handleRenameFolder={handleRenameFolder}
              handleToggleFolderFavorite={handleToggleFolderFavorite}
              countDocsInTree={countDocsInTree}
              selectAllInFolder={selectAllInFolder}
              dragOverFolderId={dragOverFolderId}
              showFavoritesOnly={showFavoritesOnly}
              isArchiveView={isArchiveView}
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
              handleToggleCombinedFavorite={fileRowProps.handleToggleCombinedFavorite}
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

function CombinedAnalysisRow({ record, expandedCombinedAnalyses, toggleCombinedExpanded, handleDeleteCombinedAnalysis, handleToggleCombinedFavorite }: any) {
  const { privacyMode } = usePrivacyMode();
  const isExpanded = expandedCombinedAnalyses?.has(record.id);
  const ca = maskAnalysis(record.combined_analysis || {}, privacyMode);
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
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleToggleCombinedFavorite(record.id)}
              title={record.is_favorited ? 'Unfavorite' : 'Favorite'}
            >
              <Star className={`h-4 w-4 ${record.is_favorited ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => handleDeleteCombinedAnalysis(record.id)}
              title="Delete combined analysis"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-indigo-500/5 hover:bg-indigo-500/5">
          <TableCell colSpan={9} className="p-0">
            <div className="px-6 py-4 max-h-[500px] overflow-auto space-y-3">
              <AnalysisReport analysis={ca} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

function FileRow({ file, getFileIcon, user, decrementRateLimit, setSelectedFile, editingFileId, setEditingFileId, tempFileName, setTempFileName, handleRenameFile, handleAddTag, handleRemoveTag, flatFolders, handleMoveToFolder, handleAnalyze, isAnalyzing, selectedFile, rateLimitRemaining, expandedAnalysis, toggleAnalysisExpanded, teams, handleChangeTeam, handleTogglePrivate, handleToggleFavorite, expandedNotes, toggleNotesExpanded, handleSaveNote, userCredits = 0, depth = 0, selectedDocIds, toggleDocSelection, handleDraftEmail, isDraftingEmail, draftEmailDocId }: any) {
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
          <div className="flex items-center gap-1">
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
                {user?.role === 'admin' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => openShareWithUser(file.id)}>
                      <UserPlus className="mr-2 h-4 w-4" />Share with user
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={async () => {
                  await apiFetch(`/api/documents/${file.id}/`, { method: 'DELETE' });
                  window.location.reload();
                }}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.city || "--"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.ai_analysis?.county || "--"}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{file.owner_name === user?.username ? "You" : file.owner_name}</TableCell>
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {file.created_at ? new Date(file.created_at).toLocaleDateString() : '--'}
        </TableCell>
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
        <TableCell>
          {file.ai_score ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">{file.ai_score}%</Badge> : "--"}
        </TableCell>
      </TableRow>
      {isExpanded && hasAnalysis && (
        <TableRow className={cn("bg-muted/30 hover:bg-muted/40", isNotesExpanded && "border-b-0")}>
          <TableCell colSpan={9} className="p-0">
            <div className="px-6 py-4 max-h-[500px] overflow-auto">
              <AnalysisReport
                analysis={file.ai_analysis}
                emailDraft={file.email_draft}
                onDraftEmail={() => handleDraftEmail(file.id)}
                isDraftingEmail={isDraftingEmail && draftEmailDocId === file.id}
                onShare={async () => {
                  const res = await fetch(`/api/documents/${file.id}/share/`, { method: 'POST' });
                  if (!res.ok) throw new Error('Failed to generate share link');
                  const data = await res.json();
                  return `${window.location.origin}/share/${data.share_token}`;
                }}
                folders={flatFolders}
                onCreateFolder={async (name: string) => {
                  const existing = flatFolders.find((f: any) => f.name.toLowerCase() === name.toLowerCase());
                  let folder = existing;
                  if (!folder) {
                    const folderRes = await apiFetch('/api/folders/', {
                      method: 'POST',
                      body: JSON.stringify({ name }),
                    });
                    if (!folderRes.ok) return;
                    folder = await folderRes.json();
                  }
                  await apiFetch(`/api/documents/${file.id}/move/`, {
                    method: 'POST',
                    body: JSON.stringify({ folder_id: folder.id }),
                  });
                  handleMoveToFolder(file.id, folder.id);
                }}
              />
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

function formatAnalysisAsText(analysis: any, overrideSummary?: any, translatedLang?: string | null): string {
  const summary = overrideSummary ?? (analysis.summary || {});
  const lines: string[] = ['=== Property Information ==='];
  if (translatedLang) lines.push(`[Translated: ${translatedLang}]`);
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

function isNearEndOfLife(endOfLifeText: string | undefined): boolean {
  if (!endOfLifeText) return false;
  const t = endOfLifeText.toLowerCase();
  // Explicit negations — return false immediately
  if (/not\s+near\s+end\s+of\s+life/.test(t)) return false;
  if (/not\s+(at|past|reached|approaching)\s+end\s+of\s+life/.test(t)) return false;
  // Only flag explicit end-of-life proximity phrases
  if (/near\s+end\s+of\s+life/.test(t)) return true;
  if (/approaching\s+end(\s+of\s+life)?/.test(t)) return true;
  if (/past\s+(its\s+)?end\s+of\s+life/.test(t)) return true;
  if (/reached\s+end(\s+of(\s+(useful\s+)?life)?)?/.test(t)) return true;
  if (/end\s+of\s+(useful\s+)?life/.test(t)) return true;
  // "Yes" or "Yes, ..." as the whole / start of value
  if (/^yes\b/.test(t)) return true;
  // Flag if the first year number mentioned is ≤ 5 (includes "0 years left")
  const match = t.match(/(\d+)\s*(?:–|-|to)?\s*\d*\s*year/);
  if (match) {
    const low = parseInt(match[1], 10);
    return low <= 5;
  }
  return false;
}

function InspectionSection({ title, data }: { title: string; data: any }) {
  if (!data) return null;

  if (title === "Additional Notes" && typeof data === 'object') {
    return (
      <div className="space-y-2 rounded-lg border p-3 bg-card" data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
        </div>
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

  const nearEol = isNearEndOfLife(data.end_of_life);

  // Pest Inspection: render Section 1 / Section 2 sub-objects if present
  if (title === "Pest Inspection" && (data.section_1 || data.section_2)) {
    return (
      <div className="space-y-1.5 rounded-lg border p-3 bg-card" data-testid="section-pest-inspection">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-primary">{title}</h4>
          <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
        </div>
        {data.condition && <p className="text-xs"><span className="font-medium text-foreground">Condition:</span> <span className="text-muted-foreground">{data.condition}</span></p>}
        {(['section_1', 'section_2'] as const).map(key => {
          const section = data[key];
          if (!section) return null;
          const label = key === 'section_1' ? 'Section 1 — Active Infestation / Damage' : 'Section 2 — Conditions Likely to Lead to Infestation';
          return (
            <div key={key} className={`rounded-md border p-2.5 space-y-1.5 ${key === 'section_1' ? 'border-red-300/50 bg-red-500/5' : 'border-yellow-300/50 bg-yellow-500/5'}`}>
              <p className={`text-xs font-semibold ${key === 'section_1' ? 'text-red-600' : 'text-yellow-700'}`}>{label}</p>
              {section.findings && Array.isArray(section.findings) && section.findings.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-foreground">Findings:</p>
                  <ul className="list-disc ml-4 space-y-0.5">
                    {section.findings.map((f: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {section.recommendations && <p className="text-xs"><span className="font-medium text-foreground">Recommendations:</span> <span className="text-muted-foreground">{section.recommendations}</span></p>}
              {section.estimated_cost && <p className="text-xs"><span className="font-medium text-foreground">Estimated Cost:</span> <span className="text-muted-foreground">{section.estimated_cost}</span></p>}
            </div>
          );
        })}
        {data.notes && <p className="text-xs"><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{data.notes}</span></p>}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5 rounded-lg border p-3", nearEol ? "border-orange-400/60 bg-orange-500/5" : "bg-card")} data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h4 className={cn("text-sm font-bold", nearEol ? "text-orange-600" : "text-primary")}>{title}</h4>
          {nearEol && <span className="text-[10px] font-medium text-orange-600 bg-orange-500/10 border border-orange-400/30 rounded-full px-1.5 py-0.5">Near end of life</span>}
        </div>
        <CopyButton getText={() => formatSectionAsText(title, data)} className="opacity-40 hover:opacity-100" />
      </div>
      {data.condition && <p className="text-xs"><span className="font-medium text-foreground">Condition:</span> <span className="text-muted-foreground">{data.condition}</span></p>}
      {data.age && <p className="text-xs"><span className="font-medium text-foreground">Age:</span> <span className="text-muted-foreground">{data.age}</span></p>}
      {data.end_of_life && <p className="text-xs"><span className="font-medium text-foreground">End of Life:</span> <span className={nearEol ? "text-orange-600 font-medium" : "text-muted-foreground"}>{data.end_of_life}</span></p>}
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

const TRANSLATE_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "vi", label: "Vietnamese" },
  { code: "tl", label: "Filipino" },
  { code: "it", label: "Italian" },
];

function extractStringPaths(obj: any, path: (string | number)[] = []): { path: (string | number)[]; value: string }[] {
  if (typeof obj === "string" && obj.trim()) return [{ path, value: obj }];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => extractStringPaths(v, [...path, i]));
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => extractStringPaths(v, [...path, k]));
  return [];
}

function applyStringPaths(obj: any, entries: { path: (string | number)[]; value: string }[]): any {
  const clone = JSON.parse(JSON.stringify(obj));
  for (const { path, value } of entries) {
    let curr = clone;
    for (let i = 0; i < path.length - 1; i++) curr = curr[path[i]];
    curr[path[path.length - 1]] = value;
  }
  return clone;
}

async function translateAnalysis(summary: any, targetLang: string, targetLabel: string): Promise<any> {
  const entries = extractStringPaths(summary);
  if (entries.length === 0) return summary;
  const res = await apiFetch("/api/translate/", {
    method: "POST",
    body: JSON.stringify({ q: entries.map(e => e.value), target: targetLang, targetLabel }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Translation failed");
  }
  const { translations } = await res.json();
  const translated = entries.map((e, i) => ({ path: e.path, value: translations[i] ?? e.value }));
  return applyStringPaths(summary, translated);
}

function AnalysisReport({ analysis, emailDraft, onDraftEmail, isDraftingEmail, onShare, onCreateFolder, folders }: { analysis: any; emailDraft?: string; onDraftEmail?: () => void; isDraftingEmail?: boolean; onShare?: () => Promise<string>; onCreateFolder?: (name: string) => Promise<void>; folders?: Array<{id: number; name: string}> }) {
  const summary = analysis.summary || {};
  const mainSections = ["Roof", "Electrical", "Plumbing", "Foundation", "HVAC"];
  const otherSections = ["Permits", "Pest Inspection"];
  const { toast } = useToast();
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showFolderPanel, setShowFolderPanel] = useState(false);
  const [selectedLang, setSelectedLang] = useState("es");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<any>(null);
  const [translatedLangLabel, setTranslatedLangLabel] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const addressStr = [analysis.addressNumber, analysis.streetName, analysis.suffix].filter(Boolean).join(' ');
  const matchingFolder = useMemo(() => folders?.find(f => f.name.toLowerCase() === addressStr.toLowerCase()), [folders, addressStr]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => matchingFolder ? String(matchingFolder.id) : '__new__');
  const [newFolderName, setNewFolderName] = useState(addressStr || '');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderCreated, setFolderCreated] = useState(false);
  const prevEmailDraft = React.useRef(emailDraft);

  // Update selectedFolderId if folders load after mount
  useEffect(() => {
    if (matchingFolder && selectedFolderId === '__new__') {
      setSelectedFolderId(String(matchingFolder.id));
    }
  }, [matchingFolder?.id]);

  const handleAddToFolder = async () => {
    if (!onCreateFolder) return;
    setIsCreatingFolder(true);
    if (selectedFolderId === '__new__') {
      if (!newFolderName.trim()) { setIsCreatingFolder(false); return; }
      await onCreateFolder(newFolderName.trim());
    } else {
      const folder = folders?.find(f => String(f.id) === selectedFolderId);
      if (folder) await onCreateFolder(folder.name);
    }
    setIsCreatingFolder(false);
    setFolderCreated(true);
    setShowFolderPanel(false);
  };

  // Auto-open dialog when a new email draft arrives
  React.useEffect(() => {
    if (emailDraft && emailDraft !== prevEmailDraft.current) {
      setShowEmailDialog(true);
    }
    prevEmailDraft.current = emailDraft;
  }, [emailDraft]);

  const handleDraftClick = () => {
    if (emailDraft) {
      setShowEmailDialog(true);
    } else {
      onDraftEmail?.();
    }
  };

  const handleTranslate = async () => {
    setIsTranslating(true);
    const lang = TRANSLATE_LANGUAGES.find(l => l.code === selectedLang)?.label ?? selectedLang;
    console.log(`[translate] starting: target=${selectedLang} (${lang})`);
    try {
      const translated = await translateAnalysis(analysis.summary || {}, selectedLang, lang);
      console.log(`[translate] success`);
      setTranslatedSummary(translated);
      setTranslatedLangLabel(lang);
    } catch (err: any) {
      console.error(`[translate] error:`, err);
      toast({ title: "Translation failed", description: err.message, variant: "destructive" });
    }
    setIsTranslating(false);
  };

  const handleExportPdf = async () => {
    if (!reportRef.current) {
      console.error(`[export-pdf] reportRef is null`);
      toast({ title: "PDF export failed", description: "Could not find the report element.", variant: "destructive" });
      return;
    }
    setIsExportingPdf(true);
    console.log(`[export-pdf] starting`);
    try {
      const { toPng } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");
      console.log(`[export-pdf] libraries loaded, capturing element via html-to-image`);

      const dataUrl = await toPng(reportRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      console.log(`[export-pdf] capture complete, building PDF`);

      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
      const margin = 20;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (img.height * imgWidth) / img.width;
      const availableHeight = pageHeight - margin * 2;

      // Slice the image across pages
      let srcY = 0;
      while (srcY < img.height) {
        const sliceImgHeight = Math.min(img.height - srcY, availableHeight * (img.height / imgHeight));
        const slicePdfHeight = sliceImgHeight * (imgWidth / img.width);
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = img.width;
        sliceCanvas.height = Math.ceil(sliceImgHeight);
        const ctx = sliceCanvas.getContext("2d")!;
        ctx.drawImage(img, 0, -srcY, img.width, img.height);
        pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin, imgWidth, slicePdfHeight);
        srcY += sliceImgHeight;
        if (srcY < img.height) pdf.addPage();
      }

      const langSuffix = translatedLangLabel ? ` - ${translatedLangLabel}` : "";
      const fileName = addressStr
        ? `${addressStr} - Property Brief${langSuffix}.pdf`
        : `Property Brief${langSuffix}.pdf`;
      console.log(`[export-pdf] saving as: "${fileName}" (${pdf.getNumberOfPages()} pages)`);
      pdf.save(fileName);
    } catch (err: any) {
      console.error(`[export-pdf] error:`, err);
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    }
    setIsExportingPdf(false);
  };

  const handleCopy = () => {
    if (emailDraft) navigator.clipboard.writeText(emailDraft);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!onShare) return;
    setIsSharing(true);
    try {
      const url = await onShare();
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } finally {
      setIsSharing(false);
    }
  };

  const displaySummary = translatedSummary ?? summary;

  return (
    <div className="space-y-4" data-testid="analysis-report">
      <div ref={reportRef} className="space-y-4 bg-background">
      <div className="rounded-lg border bg-primary/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Property Information</h3>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {analysis.document_type && <Badge variant="secondary" className="text-[10px]">{analysis.document_type}</Badge>}
            {onDraftEmail && (
              <Button
                variant="outline" size="sm"
                className="h-6 gap-1.5 px-2 text-[10px]"
                onClick={handleDraftClick}
                disabled={isDraftingEmail}
              >
                {isDraftingEmail
                  ? <><RefreshCw className="h-3 w-3 animate-spin" />Drafting…</>
                  : emailDraft
                    ? <><Mail className="h-3 w-3" />View Email</>
                    : <><Mail className="h-3 w-3" />Draft Email</>}
              </Button>
            )}
            {onShare && (
              <Button
                variant="outline" size="sm"
                className="h-6 gap-1.5 px-2 text-[10px]"
                onClick={handleShare}
                disabled={isSharing}
              >
                {isSharing
                  ? <><RefreshCw className="h-3 w-3 animate-spin" />Copying…</>
                  : shareCopied
                    ? <><Check className="h-3 w-3 text-green-500" />Copied!</>
                    : <><Share2 className="h-3 w-3" />Share</>}
              </Button>
            )}
            <CopyButton getText={() => formatAnalysisAsText(analysis, displaySummary, translatedLangLabel)} />
            {onCreateFolder && (
              <Button
                variant="outline" size="sm"
                className="h-6 gap-1.5 px-2 text-[10px]"
                onClick={() => setShowFolderPanel(p => !p)}
              >
                {folderCreated
                  ? <><Check className="h-3 w-3 text-green-500" />Added to Folder</>
                  : <><FolderPlus className="h-3 w-3" />Add to Folder</>}
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {analysis.addressNumber && <p><span className="font-medium">Address:</span> {analysis.addressNumber} {analysis.streetName} {analysis.suffix}</p>}
          {analysis.city && <p><span className="font-medium">City:</span> {analysis.city}</p>}
          {analysis.county && <p><span className="font-medium">County:</span> {analysis.county}</p>}
          {analysis.zipcode && <p><span className="font-medium">Zipcode:</span> {analysis.zipcode}</p>}
          {analysis.fileName && <p className="col-span-2"><span className="font-medium">File:</span> {analysis.fileName}</p>}
        </div>
        {showFolderPanel && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="Select folder" />
              </SelectTrigger>
              <SelectContent>
                {folders?.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)} className="text-xs">{f.name}</SelectItem>
                ))}
                <SelectItem value="__new__" className="text-xs">New folder…</SelectItem>
              </SelectContent>
            </Select>
            {selectedFolderId === '__new__' && (
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Client Name or Property Address"
                className="h-7 text-xs flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleAddToFolder()}
                autoFocus
              />
            )}
            <Button size="sm" className="h-7 text-xs px-3" onClick={handleAddToFolder} disabled={isCreatingFolder || (selectedFolderId === '__new__' && !newFolderName.trim())}>
              {isCreatingFolder ? <RefreshCw className="h-3 w-3 animate-spin" /> : selectedFolderId === '__new__' ? 'Create & Add' : 'Add'}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold">
            Inspection Summary
            {translatedLangLabel && <span className="ml-2 text-[10px] font-normal text-muted-foreground">({translatedLangLabel})</span>}
          </h3>
          <div className="flex items-center gap-1.5">
            <Select value={selectedLang} onValueChange={(v) => { setSelectedLang(v); setTranslatedSummary(null); setTranslatedLangLabel(null); }}>
              <SelectTrigger className="h-6 text-[10px] w-36 px-2">
                <Languages className="h-3 w-3 mr-1 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSLATE_LANGUAGES.map(l => (
                  <SelectItem key={l.code} value={l.code} className="text-xs">{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline" size="sm"
              className="h-6 gap-1.5 px-2 text-[10px]"
              onClick={handleTranslate}
              disabled={isTranslating}
            >
              {isTranslating
                ? <><RefreshCw className="h-3 w-3 animate-spin" />Translating…</>
                : <><Languages className="h-3 w-3" />Translate (1 credit)</>}
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-6 gap-1.5 px-2 text-[10px]"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
            >
              {isExportingPdf
                ? <><RefreshCw className="h-3 w-3 animate-spin" />Exporting…</>
                : <><FileDown className="h-3 w-3" />Export PDF</>}
            </Button>
          </div>
        </div>
        {analysis.conflict_notes && (
          <div className="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-700">
            <span className="font-semibold">Conflict notes: </span>{analysis.conflict_notes}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          {mainSections.map(section => displaySummary[section] && (
            <InspectionSection key={section} title={section} data={displaySummary[section]} />
          ))}
        </div>
        {otherSections.map(section => displaySummary[section] && (
          <InspectionSection key={section} title={section} data={displaySummary[section]} />
        ))}
        {displaySummary["Additional Notes"] && (
          <InspectionSection title="Additional Notes" data={displaySummary["Additional Notes"]} />
        )}
      </div>
      </div>

      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />Inspection Email Draft
            </DialogTitle>
            <DialogDescription>
              AI-generated neutral summary email. Review before sending.
            </DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={emailDraft || ""}
            className="w-full h-80 resize-none rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground focus:outline-none"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="gap-2 mr-auto" onClick={() => { onDraftEmail?.(); }} disabled={isDraftingEmail}>
              {isDraftingEmail ? <><RefreshCw className="h-4 w-4 animate-spin" />Regenerating…</> : <><RefreshCw className="h-4 w-4" />Regenerate</>}
            </Button>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>Close</Button>
            <Button onClick={handleCopy} className="gap-2">
              {emailCopied ? <><Check className="h-4 w-4" />Copied!</> : <><Copy className="h-4 w-4" />Copy</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
