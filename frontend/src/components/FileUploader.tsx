import React, { useState, useCallback } from "react";
import { sha256 } from "js-sha256";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { UploadCloud, FileText, AlertTriangle, Info } from "lucide-react";
import { getIdToken } from "../firebase/auth";

type AnalysisType = "static" | "dynamic";

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

  return (
    <div className="p-4 flex justify-center">
      <Card className="w-[720px]">
        <CardHeader>
          <CardTitle>App Security Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Idle / file selection */}
          {status === "idle" && (
            <div className="space-y-4">
              {/* Analysis type selection using radio-like buttons */}
              <Label className="mb-2 block">Analysis Type</Label>
              <div className="flex space-x-4">
                {(["static", "dynamic"] as AnalysisType[]).map((type) => (
                  <div
                    key={type}
                    className="flex items-center cursor-pointer"
                    onClick={() => setAnalysisType(type)}
                  >
                    {/* Custom radio button style */}
                    <span className={`w-5 h-5 mr-2 rounded-full border-2 flex items-center justify-center
                      ${analysisType === type
                        ? "bg-primary border-primary"
                        : "border-gray-400/50 bg-background hover:border-white transition-colors duration-200"
                      }`}
                    >
                      {analysisType === type && <span className="w-2.5 h-2.5 rounded-full bg-white"></span>}
                    </span>
                    <Label>{type.charAt(0).toUpperCase() + type.slice(1)}</Label>
                  </div>
                ))}
              </div>
              
              {/* Drag & drop area */}
              <div
                onDragOver={onDragOver}      // Highlight when dragging over
                onDragLeave={onDragLeave}    // Remove highlight
                onDrop={onDrop}              // Handle file drop
                className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg cursor-pointer
                  border-gray-400/50 hover:border-white transition-colors duration-200
                  ${isDragOver ? "bg-white/20" : ""}`}
                onClick={() => document.getElementById("file-upload")?.click()} // Open file dialog on click
              >
                <UploadCloud className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  Drag & drop your APK/IPA file here, or click to select a file.
                </p>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".apk,.ipa"
                  onChange={(e) => e.target.files && handleFile(e.target.files[0])} // Handle file selection
                />
              </div>
            </div>
          )}

          {/* Duplicate found */}
          {status === "duplicate_found" && (
            <div className="flex flex-col items-center justify-center p-12 border rounded-lg w-full">
              {/* Show warning icon and title */}
              <AlertTriangle className="mb-2  text-yellow-600 h-10 w-10" />
              <p className="text-lg font-semibold text-center">Duplicate File Detected</p>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                This file with the same analysis type has already been uploaded.
              </p>
              {/* Reset to allow uploading another file */}
              <Button variant="outline" onClick={resetState} className="mt-6">
                Select Another File
              </Button>
            </div>
          )}

          {/* Reusing upload */}
          {status === "reusing_upload" && (
            <div className="flex flex-col items-center justify-center p-12 border rounded-lg w-full">
              {/* Show info icon and title */}
              <Info className="mb-2 text-blue-600 h-10 w-10" />
              <p className="text-lg font-semibold text-center">Reusing Existing Upload</p>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                This file has already been uploaded. The analysis type is different, so we are reusing the existing file.
              </p>
              {/* Reset to allow uploading another file */}
              <Button variant="outline" onClick={resetState} className="mt-6">
                Upload Another File
              </Button>
            </div>
          )}

          {/* Uploading / uploaded / error */}
          {["uploading", "uploaded_for_analysis", "error"].includes(status) && (
            <div className="flex flex-col items-center justify-center p-12 border rounded-lg w-full">
              {/* Display current upload status */}
              <p className="mt-4 text-center font-medium">{status}</p>
          
              {/* Show file name + analysis type */}
              {file && (
                <div className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>{file.name} ({analysisType})</span>
                </div>
              )}

              {/* Progress bar for uploading */}
              {status === "uploading" && <Progress value={progress} className="w-full mt-4 h-3" />}
            
              {/* Show reset button for uploaded or error states */}
              {["uploaded_for_analysis", "error"].includes(status) && (
                <Button variant="outline" onClick={resetState} className="mt-6">
                  {status === "error" ? "Try Again" : "Analyze Another File"}
                </Button>
              )}
            </div>
          )}

        </CardContent>
      </Card>
    </div>

  );
};

export default FileUploader;
