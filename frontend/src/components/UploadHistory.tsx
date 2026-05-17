import React, { useEffect, useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Calendar, FileText, CheckCircle, Loader2, AlertCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { getIdToken } from "../firebase/auth";
import { auth } from "../firebase/config";

// Structure of an upload entry, might need to adjust based on actual backend response
interface UploadEntry {
  id: string;
  filename: string;
  analysisType: string;
  status: string;
  filePath?: string;
  hash?: string;
  uploadTime?: string;
}


// Optional prop to trigger refresh from parent component
interface UploadHistoryProps {
  refreshSignal?: number;
}

const UploadHistory: React.FC<UploadHistoryProps> = ({ refreshSignal }) => {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  // Fetch upload history from backend
  const fetchUploads = async () => {
    try {
      // Ensure token is fresh
      const token = await auth.currentUser?.getIdToken(true);  // Force token refresh
    
      if (!token) {
        console.error("No valid token found.");
        return;
      }
    
      // Send the request with the fresh token
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/uploads`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
    
      if (!res.ok) {
        console.error("Fetch uploads failed with status", res.status);
        return;
      }
    
      const data = await res.json();
      setUploads(data);
    } catch (error) {
      console.error("Error fetching uploads:", error);
    }
  };

  // Trigger analysis for a specific upload
  const handleAnalyze = async (upload: UploadEntry) => {
    try {
      let endpoint = "";

      if (upload.filename.endsWith(".ipa") && upload.analysisType === "static") {
        endpoint = `${import.meta.env.VITE_BACKEND_URL}/ios-static-analyze`;
      } else if (upload.filename.endsWith(".apk") && upload.analysisType === "static") {
        endpoint = `${import.meta.env.VITE_BACKEND_URL}/android-static-analyze`;
      } else if (upload.filename.endsWith(".apk") && upload.analysisType === "dynamic") {
        endpoint = `${import.meta.env.VITE_BACKEND_URL}/android-dynamic-analyze`;
      } else {
        throw new Error("File not eligible for analysis");
        return;
      }

      // Call backend analyze API
      const token = await getIdToken();
      if (!token) throw new Error("User not logged in");

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ hash: upload.hash }),
      });
      if (!res.ok) throw new Error("Failed to trigger analysis");

      // Start polling until the file is done
      const pollInterval = 3000; // 3 seconds
      const maxAttempts = 40;    // ~2 minutes max
      let attempts = 0;

      // Polling loop function to check if report is ready
      const pollStatus = async () => {
        attempts++; // Increment attempt counter to avoid infinite polling
        // Fetch the latest uploads data from backend
        const statusRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/uploads`, {
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        });
        const statusData: UploadEntry[] = await statusRes.json();
        // Find the exact upload entry matching both hash and analysis type
        const updated = statusData.find(
          (u) => u.hash === upload.hash && u.analysisType === upload.analysisType
        );
        // Update the local state with the new status
        if (updated) {
          setUploads((prev) =>
            prev.map((u) =>
              u.hash === updated.hash && u.analysisType === updated.analysisType ? updated : u
            )
          );
        }
        // Poll if max attempts not reached and still not done
        if (updated?.status !== "done" && attempts < maxAttempts) {
          setTimeout(pollStatus, pollInterval);
        }
      };

      pollStatus();

    } catch (err) {
      console.error("Analyze error:", err);
    }
  };

  // Trigger PDF report generation and download
  const handleReportGeneration = async (upload: UploadEntry) => {
    const token = await getIdToken();
    if (!token) throw new Error("User not logged in");

    try {
      // Call backend generate-report API
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/generate-report`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
         },
        body: JSON.stringify({
          hash: upload.hash,
          type: upload.analysisType,
        })
      });
      if (!res.ok) throw new Error("Failed to trigger report generation");

      // Download the generated PDF
      const blob = await res.blob();                // Get the response as a blob
      const url = window.URL.createObjectURL(blob); // Create a URL for the blob
      const link = document.createElement("a");     // Create a temporary "a" element
      link.href = url;                              // Set the href to the blob URL
      link.setAttribute("download", `${upload.filename}-${upload.analysisType}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);           // Clean up the temp "a" element
      window.URL.revokeObjectURL(url);              // Clean up the URL object
    } catch (err) {
      console.error("Report generation error:", err);
    }
  }

  // Retry analysis for errored uploads
  const handleRetry = async (upload: UploadEntry) => {
    try {
      const token = await getIdToken();
      if (!token) throw new Error("User not logged in");
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/retry`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ hash: upload.hash, type: upload.analysisType }),
      });
      if (!res.ok) throw new Error("Retry failed");
      fetchUploads(); // Refetch uploads to update status to pending
    } catch (err) {
      console.error("Retry error:", err);
    }
  };

  // Ensure refresh when new file is uploaded
  useEffect(() => {
    fetchUploads();
  }, [refreshSignal]);

  useEffect(() => {
    const intervalId = setInterval(fetchUploads, 10000); // Refresh every 10 seconds
    return () => clearInterval(intervalId); // Cleanup on unmount
  }, []);

  // Helper function to capitalize the first letter of status, not essential but looks better
  const capitalizeStatus = (status: string) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  // Specific icon for each status
  const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
      case "analyzing":
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case "done":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full mt-4">
      <CardHeader>
        <CardTitle>Analysis History</CardTitle>
      </CardHeader>

      <CardContent>
        {/* Simple message if no uploads */}
        {uploads.length === 0 ? (
          <p>No uploads yet.</p>
        ) : (
          // Accordion for each upload entry
          <Accordion type="single" collapsible className="w-full" defaultValue="">
            {uploads.map((upload) => (
              <AccordionItem key={upload.id} value={upload.id}>
                {/* Trigger to expand/collapse each upload entry */}
                <AccordionTrigger>
                  <div className="flex justify-between items-center w-full pr-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium truncate">{upload.filename}</span>
                      <Badge variant="outline" className="capitalize">{upload.analysisType}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {/* Format upload time, fallback to "N/A" if not available */}
                      <span>{upload.uploadTime ? new Date(upload.uploadTime).toLocaleDateString() : "N/A"}</span>
                    </div>
                  </div>
                </AccordionTrigger>

                {/* Content shown when an upload entry is expanded */}
                <AccordionContent>
                  <div className="pl-8 pr-4 py-4 space-y-2 relative">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={upload.status} />
                      <span className="font-medium">{capitalizeStatus(upload.status)}</span>
                    </div>
                    {/* Display file hash */}
                    <p>Hash: {upload.hash}</p>

                    {/* Show analyze button */}
                    <div className="flex justify-end">
                      {upload.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAnalyze(upload)}
                        >
                          Analyze
                        </Button>
                      )}
                      {upload.status === "done" && (
                        <Button size="sm" onClick={() => handleReportGeneration(upload)}>
                          Download PDF
                        </Button>
                      )}
                      {upload.status === "analyzing" && (
                        <Button size="sm" disabled>
                          Analyzing...
                        </Button>
                      )}
                      {upload.status === "error" && (
                        <Button size="sm" onClick={() => handleRetry(upload)}>
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
};

export default UploadHistory;
