import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FileText, Download, ChevronDown, ChevronRight, Loader2, Paperclip } from 'lucide-react';
import { api } from '../../lib/api';
import toast from 'react-hot-toast';

interface LeadFile {
  id: string;
  leadId: string;
  stage: string;
  fileType: string;
  fileName: string;
  storagePath: string;
  signedUrl?: string;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

interface Props {
  leadId: string;
  currentStage: string;
  /** Legacy floor plan URL set directly on the Lead record (pre-LeadFile-system
   * uploads, or leads created via webhook). If set and no FLOOR_PLAN LeadFile
   * exists yet, the relevant EL/MQL/DQL folder shows it as satisfied instead
   * of falsely flagging it as missing (task #39). */
  floorPlanUrl?: string | null;
}

// EFFECTIVE_LEAD/HANDED_OVER kept as legacy bookends so currentIdx math still
// works correctly for pre-existing leads still on those stages.
const STAGE_ORDER = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'HANDED_OVER',
];
const STAGE_LABELS: Record<string, string> = {
  EFFECTIVE_LEAD: 'Effective Lead', MQL: 'MQL', DQL: 'DQL',
  PROPOSAL_READY: 'Proposal Ready', PROPOSAL_PRESENTED: 'Proposal Presented',
  PROPOSAL_DISCUSSION: 'Proposal Discussion',
  ONBOARDING: 'Onboarding', ONBOARDING_MEETING: 'Onboarding Meeting',
  DESIGN_IN_PROGRESS: 'Design in Progress', HANDED_OVER: 'Handed Over',
};

const FILE_TYPE_LABELS: Record<string, string> = {
  FLOOR_PLAN: 'Floor Plan',
  LIFESTYLE_CAPTURE: 'Lifestyle Capture',
  PITCH_PRESENTATION: 'Pitch Presentation',
  QUOTATION: 'Quotation',
  GENERATED_QUOTE: 'Generated Quote',
  PAYMENT_SCREENSHOT: 'Payment Screenshot',
  OB_QUOTE: 'OB Quote',
  WELCOME_MAIL_SCREENSHOT: 'Welcome Mail Approval Screenshot',
  FINAL_PITCH_PRESENTATION: 'Final Pitch Presentation',
  PP_QUOTATION: 'PP quotation',
  PR_QUOTATION: 'PR quotation',
  PR_PRESENTATION: 'PR presentation',
  OTHER: 'Other',
};

interface RequiredFileGroup { types: string[]; mode: 'all' | 'any' }

/**
 * Required file types per stage (Task #83/#84 — mirrors stageRequirements.ts
 * and the PD→OB / OB→OBM checklist gates). Each stage maps to one or more
 * independent groups (all groups must be satisfied); within a group,
 * `mode: 'all'` means every listed type must be present, `mode: 'any'` means
 * at least one of them satisfies it.
 * PROPOSAL_PRESENTED has no required file here: advancing to Proposal
 * Discussion is gated on a generated Quote (or an uploaded quotation file —
 * shown informally under Files → PP), not a specific required upload here.
 */
const REQUIRED_FILES: Record<string, RequiredFileGroup[]> = {
  // Floor plan + lifestyle capture sheet, per the MQL→DQL gate.
  MQL: [{ types: ['FLOOR_PLAN', 'LIFESTYLE_CAPTURE'], mode: 'all' }],
  // "Pitch-ready" file — DQL→Proposal Ready gate.
  DQL: [{ types: ['PITCH_PRESENTATION'], mode: 'all' }],
  // PP presentation attached — Proposal Ready→Proposal Presented gate.
  PROPOSAL_READY: [{ types: ['PITCH_PRESENTATION'], mode: 'all' }],
  // Final pitch presentation OR PD file — Proposal Discussion→Onboarding gate,
  // AND (independently) the welcome-mail approval screenshot required by the
  // PD→OB checklist's "Share welcome mail" action (Task #84 — moved here
  // from the OB→OBM checklist, since it now gates the PD→OB mail).
  // (The PD→OB checklist itself additionally requires a Payment Screenshot
  // and OB Quote — see the PD→OB checklist panel, not this folder badge.)
  PROPOSAL_DISCUSSION: [
    { types: ['PITCH_PRESENTATION', 'QUOTATION'], mode: 'any' },
    { types: ['WELCOME_MAIL_SCREENSHOT'], mode: 'all' },
  ],
  ONBOARDING: [{ types: ['GENERATED_QUOTE'], mode: 'all' }],
};

const FILE_TYPE_OPTIONS = [
  { value: 'FLOOR_PLAN', label: 'Floor Plan' },
  { value: 'LIFESTYLE_CAPTURE', label: 'Lifestyle Capture' },
  { value: 'PITCH_PRESENTATION', label: 'Pitch Presentation' },
  { value: 'QUOTATION', label: 'Quotation' },
  { value: 'GENERATED_QUOTE', label: 'Generated Quote' },
  { value: 'PAYMENT_SCREENSHOT', label: 'Payment Screenshot' },
  { value: 'OB_QUOTE', label: 'OB Quote' },
  { value: 'WELCOME_MAIL_SCREENSHOT', label: 'Welcome Mail Approval Screenshot' },
  { value: 'FINAL_PITCH_PRESENTATION', label: 'Final Pitch Presentation' },
  { value: 'PP_QUOTATION', label: 'PP quotation' },
  { value: 'PR_QUOTATION', label: 'PR quotation' },
  { value: 'PR_PRESENTATION', label: 'PR presentation' },
  { value: 'OTHER', label: 'Other' },
];

const ALLOWED_EXTS = '.pdf,.jpg,.jpeg,.png,.webp,.ppt,.pptx,.doc,.docx,.xls,.xlsx';

function getApiBase(): string {
  return (import.meta as any).env?.VITE_API_URL ?? '';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return '🖼';
  if (ext === 'pdf') return '📄';
  if (['ppt', 'pptx'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📈';
  return '📎';
}

interface RequiredGroupStatus extends RequiredFileGroup {
  satisfied: boolean;
  isLegacy?: boolean;
}

interface StageFolder {
  stage: string;
  files: LeadFile[];
  requiredGroups: RequiredGroupStatus[];
  hasRequired: boolean;
}

function requiredBadgeLabel(types: string[], mode: 'all' | 'any'): string {
  const labels = types.map((t) => FILE_TYPE_LABELS[t] ?? t);
  return mode === 'any' ? labels.join(' or ') : labels.join(' + ');
}

export default function FilesTab({ leadId, currentStage, floorPlanUrl }: Props) {
  const [files, setFiles] = useState<LeadFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [uploadState, setUploadState] = useState<Record<string, boolean>>({});
  const [showUploadForm, setShowUploadForm] = useState<string | null>(null);
  const [uploadFileType, setUploadFileType] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { files: raw } = await api.get<{ files: LeadFile[] }>(`/leads/${leadId}/files`);
      setFiles(raw);
    } catch {
      toast.error('Could not load files');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Auto-open the current stage folder and any with files
  useEffect(() => {
    if (!files.length && !currentStage) return;
    const initial: Record<string, boolean> = {};
    initial[currentStage] = true;
    for (const f of files) initial[f.stage] = true;
    setOpenFolders((prev) => ({ ...initial, ...prev }));
  }, [currentStage, files]);

  const handleUpload = async (stage: string) => {
    if (!selectedFile || !uploadFileType) {
      toast.error('Select a file type and a file');
      return;
    }
    setUploadState((s) => ({ ...s, [stage]: true }));
    try {
      const token = localStorage.getItem('crm_token') ?? '';
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('stage', stage);
      fd.append('fileType', uploadFileType);

      const resp = await fetch(`${getApiBase()}/api/leads/${leadId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error ?? 'Upload failed');
      }
      toast.success('File uploaded');
      setShowUploadForm(null);
      setSelectedFile(null);
      setUploadFileType('');
      await loadFiles();
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setUploadState((s) => ({ ...s, [stage]: false }));
    }
  };

  // Build stage folders for stages up to and including the current one, plus any with files
  const stagesWithContent = new Set<string>([currentStage, ...files.map((f) => f.stage)]);
  const hasAnyFloorPlanFile = files.some((f) => f.fileType === 'FLOOR_PLAN');
  // Floor plans can be attached at any of EL/MQL/DQL — a legacy floorPlanUrl
  // (set before the LeadFile system, or via webhook) satisfies whichever of
  // those folders would otherwise show it as missing. Only the first
  // applicable folder shows the legacy badge, so it isn't duplicated across
  // all three (task #39).
  const LEGACY_FLOOR_PLAN_STAGES = ['EFFECTIVE_LEAD', 'MQL', 'DQL'];
  let legacyFloorPlanApplied = false;
  const folders: StageFolder[] = STAGE_ORDER.filter((stage) => {
    const idx = STAGE_ORDER.indexOf(stage);
    return stagesWithContent.has(stage) || idx <= currentIdx;
  }).map((stage) => {
    const stageFiles = files.filter((f) => f.stage === stage);
    const groups = REQUIRED_FILES[stage] ?? [];
    const requiredGroups: RequiredGroupStatus[] = groups.map((g) => {
      let satisfied = g.mode === 'any'
        ? g.types.some((t) => stageFiles.some((f) => f.fileType === t))
        : g.types.every((t) => stageFiles.some((f) => f.fileType === t));
      let isLegacy = false;
      if (
        !satisfied && g.types.includes('FLOOR_PLAN') && floorPlanUrl && !hasAnyFloorPlanFile
        && LEGACY_FLOOR_PLAN_STAGES.includes(stage) && !legacyFloorPlanApplied
        // Only the floor-plan legacy fallback can satisfy an "all" requirement
        // on its own when it's the sole required type in this group.
        && (g.mode === 'any' || g.types.length === 1)
      ) {
        satisfied = true;
        isLegacy = true;
        legacyFloorPlanApplied = true;
      }
      return { ...g, satisfied, isLegacy };
    });
    const hasRequired = requiredGroups.every((g) => g.satisfied);
    return { stage, files: stageFiles, requiredGroups, hasRequired };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} strokeWidth={2} className="animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400">Files are organised by stage. Required files are marked with a badge.</p>
      </div>

      {folders.map(({ stage, files: stageFiles, requiredGroups }) => {
        const isOpen = openFolders[stage] ?? false;
        const isActive = stage === currentStage;
        const isUploadOpen = showUploadForm === stage;
        const isUploading = uploadState[stage];

        return (
          <div
            key={stage}
            className={`rounded-xl border transition-all ${isActive ? 'border-brand-300 bg-brand-50/30' : 'border-gray-100 bg-white'}`}
          >
            {/* Folder header */}
            <button
              onClick={() => setOpenFolders((p) => ({ ...p, [stage]: !isOpen }))}
              className="w-full flex items-center gap-2 px-4 py-3 text-left"
            >
              {isOpen ? <ChevronDown size={14} strokeWidth={2.5} className="text-gray-400" /> : <ChevronRight size={14} strokeWidth={2.5} className="text-gray-400" />}
              <span className={`text-sm font-medium ${isActive ? 'text-brand-700' : 'text-gray-700'}`}>
                {STAGE_LABELS[stage] ?? stage}
              </span>
              {isActive && (
                <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-2 py-0.5 rounded-full ml-1">Current</span>
              )}
              {requiredGroups.length > 0 && (
                <span className="ml-auto flex flex-wrap justify-end gap-1">
                  {requiredGroups.map((g, i) => (
                    <span
                      key={i}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${g.satisfied ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {g.satisfied
                        ? `✓ ${requiredBadgeLabel(g.types, g.mode)}${g.isLegacy ? ' (legacy)' : ''}`
                        : `⚠ ${requiredBadgeLabel(g.types, g.mode)} required`}
                    </span>
                  ))}
                </span>
              )}
              {requiredGroups.length === 0 && stageFiles.length > 0 && (
                <span className="ml-auto text-[10px] text-gray-400">{stageFiles.length} file{stageFiles.length !== 1 ? 's' : ''}</span>
              )}
            </button>

            {isOpen && (
              <div className="px-4 pb-3 space-y-2">
                {/* File list */}
                {stageFiles.length === 0 && (
                  <p className="text-xs text-gray-400 py-1">No files uploaded for this stage yet.</p>
                )}
                {stageFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-3 py-2 border-t border-gray-50">
                    <span className="text-lg leading-none">{fileIcon(file.fileName)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{file.fileName}</p>
                      <p className="text-[10px] text-gray-400">
                        {FILE_TYPE_LABELS[file.fileType] ?? file.fileType} · {fmtDate(file.createdAt)} · {file.uploadedBy.name}
                      </p>
                    </div>
                    {file.signedUrl ? (
                      <a
                        href={file.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 shrink-0"
                      >
                        <Download size={12} strokeWidth={2} />
                        View
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">URL expired</span>
                    )}
                  </div>
                ))}

                {/* Upload form toggle */}
                {!isUploadOpen && (
                  <button
                    onClick={() => {
                      setShowUploadForm(stage);
                      setUploadFileType(requiredGroups[0]?.types[0] ?? '');
                      setSelectedFile(null);
                    }}
                    className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium mt-1 pt-1 border-t border-gray-50"
                  >
                    <Upload size={11} strokeWidth={2.5} />
                    Upload file
                  </button>
                )}

                {/* Upload form */}
                {isUploadOpen && (
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">File type</label>
                      <select
                        value={uploadFileType}
                        onChange={(e) => setUploadFileType(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300"
                      >
                        <option value="">Select type…</option>
                        {FILE_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">File</label>
                      <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:border-brand-400 transition-colors">
                        <Paperclip size={12} strokeWidth={2} />
                        {selectedFile ? selectedFile.name : 'Choose file (PDF, image, Word, PPT)'}
                        <input
                          ref={(el) => { fileInputRefs.current[stage] = el; }}
                          type="file"
                          accept={ALLOWED_EXTS}
                          className="hidden"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleUpload(stage)}
                        disabled={isUploading || !selectedFile || !uploadFileType}
                        className="flex-1 bg-brand-500 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
                      >
                        {isUploading ? 'Uploading…' : 'Upload'}
                      </button>
                      <button
                        onClick={() => { setShowUploadForm(null); setSelectedFile(null); }}
                        className="flex-1 border border-gray-200 text-gray-600 py-1.5 rounded-lg text-xs hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {folders.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <FileText size={24} strokeWidth={1.5} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No file folders yet</p>
        </div>
      )}
    </div>
  );
}
