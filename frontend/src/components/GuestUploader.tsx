import React, { useState, useCallback, useEffect, useRef } from "react";
import { sha256 } from "js-sha256";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

// ─── Status icon (mirrors UploadHistory) ─────────────────────────────────────

const StatusIcon: React.FC<{ status: JobStatus }> = ({ status }) => {
  switch (status) {
    case "pending":
      return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
    case "uploaded":
      return <CreditCard className="h-5 w-5 text-amber-500" />;
    case "analyzing":
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    case "done":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
};

const statusLabel: Record<JobStatus, string> = {
  pending:   "Pending",
  uploaded:  "Awaiting payment",
  analyzing: "Analyzing…",
  done:      "Done",
  error:     "Error",
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
    <div className="p-4 flex justify-center">
      <Card className="w-[720px]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>App Security Analysis</CardTitle>
            {onSwitchToAuth && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground text-xs"
                onClick={onSwitchToAuth}
              >
                Sign in / Register
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Shield className="h-3.5 w-3.5" />
            <span>Guest session — no account required</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-4">

          {/* ── Idle: file selector ──────────────────────────────────────── */}
          {step === "idle" && (
            <div className="space-y-4">
              <Label className="mb-2 block">Analysis Type</Label>
              <div className="flex space-x-4">
                {(["static", "dynamic"] as AnalysisType[]).map((type) => (
                  <div
                    key={type}
                    className="flex items-center cursor-pointer"
                    onClick={() => setAnalysisType(type)}
                  >
                    <span
                      className={`w-5 h-5 mr-2 rounded-full border-2 flex items-center justify-center
                        ${analysisType === type
                          ? "bg-primary border-primary"
                          : "border-gray-400/50 bg-background hover:border-white transition-colors duration-200"
                        }`}
                    >
                      {analysisType === type && (
                        <span className="w-2.5 h-2.5 rounded-full bg-white" />
                      )}
                    </span>
                    <Label className="cursor-pointer capitalize">{type}</Label>
                  </div>
                ))}
              </div>

              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg cursor-pointer
                  border-gray-400/50 hover:border-white transition-colors duration-200
                  ${isDragOver ? "bg-white/10" : ""}`}
                onClick={() => document.getElementById("guest-file-upload")?.click()}
              >
                <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  Drag & drop your APK/IPA file here, or click to select a file.
                </p>
                <p className="text-xs text-muted-foreground mt-2">Max 500 MB · .apk or .ipa</p>
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

          {/* ── Uploading: progress ──────────────────────────────────────── */}
          {step === "uploading" && (
            <div className="flex flex-col items-center justify-center p-10 border rounded-lg space-y-5">
              <UploadCloud className="h-10 w-10 text-primary animate-pulse" />
              <p className="font-medium text-center">
                {progress < 20 ? "Calculating checksum…" : "Uploading file…"}
              </p>
              {file && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>{file.name} · {analysisType}</span>
                </div>
              )}
              <Progress value={progress} className="w-full h-3" />
              <p className="text-xs text-muted-foreground">{progress}%</p>
            </div>
          )}

          {/* ── Tracking: single job card ────────────────────────────────── */}
          {step === "tracking" && (
            <div className="space-y-4">

              {/* Error before job was created */}
              {errorMsg && !job && (
                <div className="flex flex-col items-center gap-4 p-10 border rounded-lg">
                  <AlertTriangle className="h-10 w-10 text-yellow-500" />
                  <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
                  <Button variant="outline" onClick={reset}>Try again</Button>
                </div>
              )}

              {/* Job card — styled to match UploadHistory rows */}
              {job && (
                <div className="border rounded-lg overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{job.filename}</span>
                      <Badge variant="outline" className="capitalize shrink-0">
                        {job.analysisType}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-4">
                      {new Date(job.uploadTime).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="px-4 py-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={job.status} />
                      <span className="font-medium text-sm">{statusLabel[job.status]}</span>
                    </div>

                    <div className="flex justify-end">
                      {(job.status === "pending" || job.status === "analyzing") && (
                        <Button size="sm" disabled variant="outline">
                          {job.status === "analyzing"
                            ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Analyzing…</>
                            : <><Clock className="h-4 w-4 mr-1" />Queued</>
                          }
                        </Button>
                      )}

                      {job.status === "uploaded" && (
                        <Button size="sm" onClick={() => setPayNotice(true)}>
                          <CreditCard className="h-4 w-4 mr-1" />
                          Pay to Analyze
                        </Button>
                      )}

                      {job.status === "done" && (
                        <Button size="sm" onClick={handleDownload}>
                          <Download className="h-4 w-4 mr-1" />
                          Download PDF
                        </Button>
                      )}

                      {job.status === "error" && (
                        <Button size="sm" variant="destructive" onClick={reset}>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Try Again
                        </Button>
                      )}
                    </div>

                    {job.status === "uploaded" && payNotice && (
                      <p className="text-xs text-muted-foreground text-right">
                        Payment isn't available yet — this feature is coming soon.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Offer to start fresh once terminal */}
              {job && (job.status === "uploaded" || job.status === "done" || job.status === "error") && (
                <div className="flex justify-center pt-2">
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Analyze another file
                  </Button>
                </div>
              )}

            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
};

export default GuestUploader;