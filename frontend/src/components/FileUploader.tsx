import React, { useState, useCallback } from "react";
import { sha256 } from "js-sha256";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  UploadCloud,
  FileText,
  AlertTriangle,
  Info,
  Shield,
  FileSearch,
  Zap,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import { getIdToken } from "../firebase/auth";

type AnalysisType = "static" | "dynamic";

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

interface ResultMeta {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  title: string;
  desc: string;
  btnLabel: string;
}

const RESULT_META: Record<string, ResultMeta> = {
  duplicate_found: {
    icon: AlertTriangle,
    tint: "bg-amber-500/15 text-amber-400",
    title: "Duplicate file detected",
    desc: "This file has already been uploaded with the same analysis type.",
    btnLabel: "Select another file",
  },
  reusing_upload: {
    icon: Info,
    tint: "bg-blue-500/15 text-blue-400",
    title: "Reusing existing upload",
    desc: "This file already exists. The analysis type is different, so we're reusing the stored file.",
    btnLabel: "Upload another file",
  },
  uploaded_for_analysis: {
    icon: CheckCircle,
    tint: "bg-green-500/15 text-green-400",
    title: "Uploaded for analysis",
    desc: "Your file was uploaded successfully and is queued for analysis.",
    btnLabel: "Analyze another file",
  },
  error: {
    icon: AlertTriangle,
    tint: "bg-red-500/15 text-red-400",
    title: "Upload failed",
    desc: "Something went wrong while uploading your file. Please try again.",
    btnLabel: "Try again",
  },
};

const ResultPanel: React.FC<{
  status: string;
  file: File | null;
  onReset: () => void;
}> = ({ status, file, onReset }) => {
  const meta = RESULT_META[status];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-10 text-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${meta.tint}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="font-semibold">{meta.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{meta.desc}</p>
      </div>
      {file && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span className="truncate max-w-[280px]">{file.name}</span>
        </span>
      )}
      <Button
        variant={status === "error" ? "destructive" : "outline"}
        size="sm"
        onClick={onReset}
        className="mt-1"
      >
        {status === "error" && <RotateCcw className="h-4 w-4" />}
        {meta.btnLabel}
      </Button>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

// Optional prop to notify parent component of new upload
interface FileUploaderProps {
  onUpload?: () => void;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onUpload }) => {
  const [analysisType, setAnalysisType] = useState<AnalysisType>("static");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Helper function that resets state of variables
  const resetState = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
  };

  // Helper function for calculating SHA-256 hash of a file
  const calculateHash = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    return sha256(uint8Array);
  };

  // Check with backend if hash already exists for this user and analysis type
  const checkHash = async (hash: string, analysisType: string) => {
    const token = await getIdToken(); // Get the Firebase token
    if (!token) {
      console.error("User not logged in");
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/check-hash`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`, // Add the Authorization header
        },
        body: JSON.stringify({ hash, analysisType }),
      });

      if (!res.ok) {
        console.error("Check-hash failed:", await res.json());
        return null;
      }

      const data = await res.json();
      return data;
    } catch (error) {
      console.error("Error checking hash:", error);
      return null;
    }
  };

  const handleFile = useCallback(

    // Take file object and set status to check for duplicate
    async (selectedFile: File) => {

      // ensure user is logged in and we have a token for subsequent XHRs
      const token = await getIdToken();
      if (!token) {
        console.error("User not logged in");
        setStatus("error");
        return;
      }

      setFile(selectedFile);
      setStatus("check_duplicate");
      setProgress(0);

      // Simulate hashing progress (0 → 20%)
      let simulatedProgress = 0;
      const hashInterval = setInterval(() => {
        simulatedProgress += Math.random() * 5; // slowly increase
        if (simulatedProgress >= 20) simulatedProgress = 20; // cap at 20%
        setProgress(Math.round(simulatedProgress));
      }, 100);

      // Calculate actual hash
      const hash = await calculateHash(selectedFile);
      clearInterval(hashInterval);

      // Check for duplicate file on backend server
      try {
        const data = await checkHash(hash, analysisType);

        switch (data.status) {
          case "duplicate":
            setStatus("duplicate_found");
            setProgress(100);
            return;
          case "reuse":
            setStatus("reusing_upload");
            setProgress(100);
            onUpload?.(); // Notify parent to refresh UploadHistory
            return;
          case "new":
            // Proceed to upload
            break;
        }
      }
      catch (error) {
        console.error("Error checking duplicate:", error);
      }

      setStatus("uploading");
      setProgress(20);

      // Prepare form data
      const fileType = selectedFile.name.endsWith(".ipa") ? "ipa" : "apk";
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("type", analysisType);
      formData.append("fileType", fileType);
      formData.append("hash", hash);

      // Upload using XMLHttpRequest to track progress
      const xhr = new XMLHttpRequest();

      // Track upload progress (20 → 100%)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = 20 + (event.loaded / event.total) * 80;
          setProgress(Math.round(percent));
        }
      };

      // Handle successful upload
      xhr.onload = async () => {
        setProgress(100);
        if (xhr.status >= 200 && xhr.status < 300) {
          setStatus("uploaded_for_analysis");

          // Consume a credit
          try {
            const token = await getIdToken();
            if (!token) throw new Error("User not logged in");

            const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/consumeCredit`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            });

            if (!res.ok) {
              console.error("Failed to consume credit:", await res.json());
            } else {
              // Optionally: get remaining credits from response
              const data = await res.json();
              console.log("Remaining credits:", data.remainingCredits);
            }
          } catch (err) {
            console.error("Error consuming credit:", err);
          }

          // Notify parent to refresh UploadHistory **and UserCredits**
          onUpload?.();
        } else {
          setStatus("error");
          console.error("Upload failed:", xhr.statusText);
        }
      };

      // Handle upload error
      xhr.onerror = () => {
        setStatus("error");
        console.error("Upload error");
      };

      xhr.open("POST", `${import.meta.env.VITE_BACKEND_URL}/upload`);
      // attach Authorization header so backend receives token for this multipart request
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.send(formData);
    },
    [analysisType, onUpload]
  );

  // Drag and drop handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true); // Highlight drop area
  };
  const onDragLeave = () => setIsDragOver(false); // Remove highlight
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false); // Remove highlight
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]); // Handle file drop
  };

  const isProcessing = status === "check_duplicate" || status === "uploading";

  return (
    <Card className="w-full">
      <CardContent className="space-y-6 p-6">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold leading-tight">App Security Analysis</h2>
            <p className="text-xs text-muted-foreground">Upload an APK or IPA to run an analysis</p>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── Idle: file selector ─────────────────────────────────────────── */}
        {status === "idle" && (
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
              onClick={() => document.getElementById("file-upload")?.click()}
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
              <p className="text-[11px] text-muted-foreground">.apk or .ipa</p>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".apk,.ipa"
                onChange={(e) => e.target.files && handleFile(e.target.files[0])}
              />
            </div>
          </div>
        )}

        {/* ── Processing: hashing / duplicate check / upload ──────────────── */}
        {isProcessing && (
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-muted/20 p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20">
              <UploadCloud className="h-7 w-7 text-primary animate-pulse" />
            </div>
            <div className="text-center">
              <p className="font-medium">
                {status === "check_duplicate"
                  ? progress < 20
                    ? "Calculating checksum…"
                    : "Checking for duplicates…"
                  : "Uploading file…"}
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

        {/* ── Result states ───────────────────────────────────────────────── */}
        {RESULT_META[status] && (
          <ResultPanel status={status} file={file} onReset={resetState} />
        )}

      </CardContent>
    </Card>
  );
};

export default FileUploader;
