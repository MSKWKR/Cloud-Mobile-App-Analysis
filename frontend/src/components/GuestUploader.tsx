import React, { useState, useCallback, useEffect, useRef } from "react";
import { sha256 } from "js-sha256";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  UploadCloud,
  FileText,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Clock,
  AlertCircle,
  Download,
  Shield,
  RotateCcw,
  CreditCard,
  FileSearch,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisType = "static" | "dynamic";

type UploadStep =
  | "idle"       // Waiting for file selection
  | "uploading"  // Hashing + sending to server
  | "tracking";  // Job created — polling for status

type JobStatus = "pending" | "uploaded" | "analyzing" | "done" | "error";

interface GuestJob {
  jobId: string;
  filename: string;
  analysisType: AnalysisType;
  status: JobStatus;
  uploadTime: string;
  downloadToken?: string;
}

// ─── Static config ────────────────────────────────────────────────────────────

const ANALYSIS_OPTIONS: {
  value: AnalysisType;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "static",
    label: "Static Analysis",
    desc: "Inspect code, permissions and configuration without running the app.",
    icon: FileSearch,
  },
  {
    value: "dynamic",
    label: "Dynamic Analysis",
    desc: "Run the app in a sandbox to observe live runtime behaviour.",
    icon: Zap,
  },
];

const StatusIcon: React.FC<{ status: JobStatus }> = ({ status }) => {
  const cls = "h-3.5 w-3.5";
  switch (status) {
    case "pending":   return <Clock className={cls} />;
    case "uploaded":  return <CreditCard className={cls} />;
    case "analyzing": return <Loader2 className={`${cls} animate-spin`} />;
    case "done":      return <CheckCircle className={cls} />;
    case "error":     return <AlertCircle className={cls} />;
  }
};

const statusLabel: Record<JobStatus, string> = {
  pending:   "Pending",
  uploaded:  "Awaiting payment",
  analyzing: "Analyzing…",
  done:      "Done",
  error:     "Error",
};

const statusPill: Record<JobStatus, string> = {
  pending:   "bg-yellow-500/15 text-yellow-400",
  uploaded:  "bg-amber-500/15 text-amber-400",
  analyzing: "bg-blue-500/15 text-blue-400",
  done:      "bg-green-500/15 text-green-400",
  error:     "bg-red-500/15 text-red-400",
};

// ─── Main component ───────────────────────────────────────────────────────────

interface GuestUploaderProps {
  onSwitchToAuth?: () => void;
}

const GuestUploader: React.FC<GuestUploaderProps> = ({ onSwitchToAuth }) => {
  const [step, setStep]                 = useState<UploadStep>("idle");
  const [analysisType, setAnalysisType] = useState<AnalysisType>("static");
  const [file, setFile]                 = useState<File | null>(null);
  const [progress, setProgress]         = useState(0);
  const [isDragOver, setIsDragOver]     = useState(false);
  const [job, setJob]                   = useState<GuestJob | null>(null);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [payNotice, setPayNotice]       = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up polling timer on unmount
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const reset = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setStep("idle");
    setFile(null);
    setProgress(0);
    setJob(null);
    setErrorMsg(null);
    setPayNotice(false);
  };

  const calculateHash = async (f: File): Promise<string> => {
    const buf = await f.arrayBuffer();
    return sha256(new Uint8Array(buf));
  };

  // ── Polling ────────────────────────────────────────────────────────────────

  const pollStatus = useCallback((jobId: string, attempts = 0) => {
    const MAX_ATTEMPTS = 80; // ~4 min at 3 s intervals
    const INTERVAL_MS  = 3000;

    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/guest/job-status/${jobId}`
        );
        if (!res.ok) throw new Error("Status check failed");

        const data: { status: JobStatus; downloadToken?: string } = await res.json();

        setJob((prev) =>
          prev ? { ...prev, status: data.status, downloadToken: data.downloadToken } : prev
        );

        // Stop polling at "uploaded" — nothing advances the job until payment;
        // also stop on terminal states or the attempt cap.
        const settled =
          data.status === "uploaded" ||
          data.status === "done" ||
          data.status === "error";
        if (!settled && attempts < MAX_ATTEMPTS) {
          pollStatus(jobId, attempts + 1);
        }
      } catch {
        // Silently retry on transient network hiccups
        if (attempts < MAX_ATTEMPTS) pollStatus(jobId, attempts + 1);
      }
    }, INTERVAL_MS);
  }, []);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(
    async (selectedFile: File) => {
      // Client-side validation
      const name = selectedFile.name.toLowerCase();
      if (!name.endsWith(".apk") && !name.endsWith(".ipa")) {
        setErrorMsg("Only .apk and .ipa files are accepted.");
        setStep("tracking");
        return;
      }
      if (selectedFile.size > 500 * 1024 * 1024) {
        setErrorMsg("File size must be under 500 MB.");
        setStep("tracking");
        return;
      }

      setFile(selectedFile);
      setStep("uploading");
      setProgress(0);

      // Hash progress simulation (0 → 20%)
      let sim = 0;
      const hashInterval = setInterval(() => {
        sim = Math.min(sim + Math.random() * 5, 20);
        setProgress(Math.round(sim));
      }, 100);

      let hash: string;
      try {
        hash = await calculateHash(selectedFile);
      } catch {
        clearInterval(hashInterval);
        setErrorMsg("Failed to read the file.");
        setStep("tracking");
        return;
      }
      clearInterval(hashInterval);
      setProgress(20);

      // Create guest job on backend
      let jobId: string;
      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/guest/create-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysisType, hash, fileName: selectedFile.name }),
        });
        if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create job.");
        ({ jobId } = await res.json());
      } catch (e: any) {
        setErrorMsg(e.message ?? "Could not reach the server.");
        setStep("tracking");
        return;
      }

      // Upload file (20 → 100%)
      const fileType = name.endsWith(".ipa") ? "ipa" : "apk";
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("jobId", jobId);
      formData.append("analysisType", analysisType);
      formData.append("fileType", fileType);
      formData.append("hash", hash);

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable)
              setProgress(Math.round(20 + (ev.loaded / ev.total) * 80));
          };
          xhr.onload  = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.statusText));
          xhr.onerror = () => reject(new Error("Network error during upload."));
          xhr.open("POST", `${import.meta.env.VITE_BACKEND_URL}/guest/upload`);
          xhr.send(formData);
        });
      } catch (e: any) {
        setErrorMsg(e.message ?? "Upload failed.");
        setStep("tracking");
        return;
      }

      setProgress(100);

      // Upload succeeded — job is now "uploaded" and waits for payment
      setJob({
        jobId,
        filename: selectedFile.name,
        analysisType,
        status: "uploaded",
        uploadTime: new Date().toISOString(),
      });
      setStep("tracking");
      // Confirm server-side status; polling stops itself once "uploaded"
      pollStatus(jobId);
    },
    [analysisType, pollStatus]
  );

  // ── PDF download ───────────────────────────────────────────────────────────

  const handleDownload = async () => {
    if (!job?.downloadToken) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/guest/report/${job.downloadToken}`
      );
      if (!res.ok) throw new Error("Download failed.");

      const blob  = await res.blob();
      const url   = window.URL.createObjectURL(blob);
      const link  = document.createElement("a");
      link.href   = url;
      link.setAttribute("download", `${job.filename}-${job.analysisType}-report.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
    }
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = () => setIsDragOver(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">App Security Analysis</h2>
            <p className="text-xs text-muted-foreground">Guest session — no account required</p>
          </div>
        </div>
        {onSwitchToAuth && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={onSwitchToAuth}
          >
            Sign in / Register
          </Button>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* ── Idle: file selector ─────────────────────────────────────────── */}
      {step === "idle" && (
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-sm font-medium">Choose analysis type</p>
            <div className="grid grid-cols-2 gap-3">
              {ANALYSIS_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = analysisType === opt.value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setAnalysisType(opt.value)}
                    className={`relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all
                      ${active
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40"
                      }`}
                  >
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg
                        ${active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-semibold">{opt.label}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{opt.desc}</span>
                    {active && (
                      <CheckCircle className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => document.getElementById("guest-file-upload")?.click()}
            className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-all
              ${isDragOver
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20 transition-transform group-hover:scale-105">
              <UploadCloud className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Drag & drop your APK or IPA file</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                or <span className="font-medium text-primary">browse</span> to choose a file
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">Max 500 MB · .apk or .ipa</p>
            <input
              id="guest-file-upload"
              type="file"
              className="hidden"
              accept=".apk,.ipa"
              onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            />
          </div>
        </div>
      )}

      {/* ── Uploading: progress ─────────────────────────────────────────── */}
      {step === "uploading" && (
        <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-muted/20 p-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20">
            <UploadCloud className="h-7 w-7 text-primary animate-pulse" />
          </div>
          <div className="text-center">
            <p className="font-medium">
              {progress < 20 ? "Calculating checksum…" : "Uploading file…"}
            </p>
            {file && (
              <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span className="truncate max-w-[320px]">{file.name}</span>
              </p>
            )}
          </div>
          <div className="w-full space-y-1.5">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span className="capitalize">{analysisType} analysis</span>
              <span>{progress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Tracking: single job card ───────────────────────────────────── */}
      {step === "tracking" && (
        <div className="space-y-4">

          {/* Error before job was created */}
          {errorMsg && !job && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/10 p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <Button variant="outline" size="sm" onClick={reset}>Try again</Button>
            </div>
          )}

          {/* Job card */}
          {job && (
            <div className="overflow-hidden rounded-xl border border-border">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{job.filename}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(job.uploadTime).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 capitalize">
                  {job.analysisType}
                </Badge>
              </div>

              {/* Body */}
              <div className="space-y-4 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusPill[job.status]}`}
                  >
                    <StatusIcon status={job.status} />
                    {statusLabel[job.status]}
                  </span>

                  {(job.status === "pending" || job.status === "analyzing") && (
                    <Button size="sm" disabled variant="outline">
                      {job.status === "analyzing"
                        ? <><Loader2 className="h-4 w-4 animate-spin" />Analyzing…</>
                        : <><Clock className="h-4 w-4" />Queued</>
                      }
                    </Button>
                  )}

                  {job.status === "uploaded" && (
                    <Button size="sm" onClick={() => setPayNotice(true)}>
                      <CreditCard className="h-4 w-4" />
                      Pay to Analyze
                    </Button>
                  )}

                  {job.status === "done" && (
                    <Button size="sm" onClick={handleDownload}>
                      <Download className="h-4 w-4" />
                      Download PDF
                    </Button>
                  )}

                  {job.status === "error" && (
                    <Button size="sm" variant="destructive" onClick={reset}>
                      <RotateCcw className="h-4 w-4" />
                      Try Again
                    </Button>
                  )}
                </div>

                {job.status === "uploaded" && (
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {payNotice
                      ? "Payment isn't available yet — this feature is coming soon."
                      : "Your file is uploaded. Complete payment to start the security analysis."}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Offer to start fresh once settled */}
          {job && (job.status === "uploaded" || job.status === "done" || job.status === "error") && (
            <div className="flex justify-center pt-1">
              <Button variant="ghost" size="sm" onClick={reset}>
                Analyze another file
              </Button>
            </div>
          )}

        </div>
      )}

    </div>
  );
};

export default GuestUploader;
