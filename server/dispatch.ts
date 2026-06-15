import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import FormData from "form-data";
import fetch from "node-fetch";
import { FileMeta } from "./models/FileMeta";
import crypto from "crypto";

const MONGO_URL = "mongodb://cloud-mongodb:27018/local_system";
const IOS_STATIC_API = "http://ios-static-backend:8080";
const ANDROID_STATIC_API = "http://android-static-wrapper:5001";
const ANDROID_DYNAMIC_API = "http://android-dynamic-wrapper:5002";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

interface TaskQueuedResponse {
  task_id: string;
  status?: string;
}

interface ScanReport {
  [key: string]: any;
}

async function connectToMongo() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URL);
    console.log("MongoDB connected");
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function analyzeIOSStatic(fileHash: string, analysisType: string = "static") {
  try {
    await connectToMongo();

    // Fetch the file document
    const fileDoc = await FileMeta.findOne({ hash: fileHash, analysisType });
    if (!fileDoc) throw new Error(`No file found with hash ${fileHash}`);
    if (fileDoc.analysisType !== "static" || !fileDoc.filename.endsWith(".ipa"))
      throw new Error(`File ${fileDoc.filename} is not eligible for IPA static analysis`);

    const filePath = path.resolve(fileDoc.filePath);
    if (!fs.existsSync(filePath)) throw new Error(`File does not exist at path ${filePath}`);

    // Prepare file upload
    const fileStream = fs.createReadStream(filePath);
    const md5Hash = crypto.createHash("md5").update(fs.readFileSync(filePath)).digest("hex");

    const form = new FormData();
    form.append("app_filename", fileDoc.filename);
    form.append("app_rawfile", fileStream, fileDoc.filename);
    form.append("md5", md5Hash);

    // Queue analysis
    const postRes = await fetch(`${IOS_STATIC_API}/scan`, { method: "POST", body: form, headers: form.getHeaders() });
    if (!postRes.ok) throw new Error(`Analysis API request failed with status ${postRes.status}`);
    const postData = (await postRes.json()) as TaskQueuedResponse;
    const taskId = postData.task_id;
    if (!taskId) throw new Error("No task_id returned from analysis API");

    // Save initial status
    fileDoc.status = "analyzing";
    fileDoc.taskId = taskId;
    await fileDoc.save();

    // Poll GET /scan/{task_id} until report is ready
    let report: ScanReport | null = null;
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      console.log(`Polling attempt ${attempt}/${MAX_POLL_ATTEMPTS} for task ${taskId}...`);
      await sleep(POLL_INTERVAL_MS);
      const getRes = await fetch(`${IOS_STATIC_API}/scan/${taskId}`);
      const statusCode = getRes.status;
      if (statusCode === 202) {
        console.log(`Task ${taskId} still queued/processing...`);
        continue;
      }
      if (statusCode === 200) {
        const data = (await getRes.json()) as any;
        if (data.result) {
          report = data;
          console.log(`Task ${taskId} completed successfully!`);
          break;
        }
        if (data.status && ["queued", "processing"].includes(data.status)) {
          console.log(`Task ${taskId} still running (status: ${data.status})...`);
          continue;
        }
        console.log(`Unexpected 200 response:`, data);
        continue;
      }
      const errText = await getRes.text();
      throw new Error(`Failed to poll task: ${statusCode} - ${errText}`);
    }
    if (!report) {
      throw new Error(`Task ${taskId} did not complete after ${MAX_POLL_ATTEMPTS} attempts`);
    }

    // Save report and update status
    const filename = `${fileDoc.hash}_static.json`;
    const folder = path.dirname(fileDoc.reportPath);
    const reportPath = path.join(folder, filename);

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fileDoc.reportPath = reportPath;
    fileDoc.status = "done";
    await fileDoc.save();

    return report;

  } catch (err) {
    console.error("Error in analyzeIOSStatic:", err);
    const fileDoc = await FileMeta.findOne({ hash: fileHash });
    if (fileDoc) {
      fileDoc.status = "error";
      await fileDoc.save();
    }
    throw err;
  }
}


export async function analyzeAndroidStatic(fileHash: string, analysisType: string = "static") {
  try {
    await connectToMongo();

    const fileDoc = await FileMeta.findOne({ hash: fileHash, analysisType });
    if (!fileDoc) throw new Error(`No file found with hash ${fileHash}`);
    if (fileDoc.analysisType !== "static" || !fileDoc.filename.endsWith(".apk"))
      throw new Error(`File ${fileDoc.filename} is not eligible for APK static analysis`);

    const filePath = path.resolve(fileDoc.filePath);
    if (!fs.existsSync(filePath)) throw new Error(`File does not exist at path ${filePath}`);

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), fileDoc.filename);
    form.append("hash", fileDoc.hash);

    fileDoc.status = "analyzing";
    await fileDoc.save();

    // Submit job — now returns 202 + job_id immediately
    const postRes = await fetch(`${ANDROID_STATIC_API}/analyze_apk`, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });
    if (postRes.status !== 202) throw new Error(`Enqueue failed with status ${postRes.status}`);
    const { job_id } = (await postRes.json()) as { job_id: string };
    if (!job_id) throw new Error("No job_id returned from wrapper");

    fileDoc.taskId = job_id;
    await fileDoc.save();

    // Poll /status/<job_id> until done
    let report: any = null;
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      console.log(`Polling attempt ${attempt}/${MAX_POLL_ATTEMPTS} for job ${job_id}...`);
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await fetch(`${ANDROID_STATIC_API}/status/${job_id}`);
      if (!statusRes.ok) throw new Error(`Status poll failed with ${statusRes.status}`);
      const data = (await statusRes.json()) as any;

      if (data.status === "pending" || data.status === "running") {
        console.log(`Job ${job_id} still running — step ${data.step ?? "?"}/${data.total ?? "?"}: ${data.message ?? ""}`);
        continue;
      }
      if (data.status === "success") {
        report = data.result;
        console.log(`Job ${job_id} completed successfully`);
        break;
      }
      throw new Error(`Job ${job_id} failed: ${data.error}`);
    }

    if (!report) throw new Error(`Job ${job_id} did not complete after ${MAX_POLL_ATTEMPTS} attempts`);

    const filename = `${fileDoc.hash}_static.json`;
    const reportPath = path.join(path.dirname(fileDoc.reportPath), filename);
    fs.writeFileSync(reportPath, typeof report === "string" ? report : JSON.stringify(report, null, 2));
    fileDoc.reportPath = reportPath;
    fileDoc.status = "done";
    await fileDoc.save();

    return report;

  } catch (err) {
    console.error("Error in analyzeAndroidStatic:", err);
    const fileDoc = await FileMeta.findOne({ hash: fileHash });
    if (fileDoc) { fileDoc.status = "error"; await fileDoc.save(); }
    throw err;
  }
}

export async function analyzeAndroidDynamic(fileHash: string, analysisType: string = "dynamic") {
  try {
    await connectToMongo();

    const fileDoc = await FileMeta.findOne({ hash: fileHash, analysisType });
    if (!fileDoc) throw new Error(`No file found with hash ${fileHash}`);
    if (fileDoc.analysisType !== "dynamic" || !fileDoc.filename.endsWith(".apk"))
      throw new Error(`File ${fileDoc.filename} is not eligible for APK dynamic analysis`);

    const filePath = path.resolve(fileDoc.filePath);
    if (!fs.existsSync(filePath)) throw new Error(`File does not exist at path ${filePath}`);
    
    const form = new FormData();
    const fileStream = fs.createReadStream(filePath);
    form.append("file", fileStream, fileDoc.filename);
    form.append("hash", fileDoc.hash);

    try {
      fileDoc.status = "analyzing";
      await fileDoc.save();

      // Call the wrapper
      const res = await fetch(`${ANDROID_DYNAMIC_API}/analyze_dynamic`, { method: "POST", body: form, headers: form.getHeaders() });
      if (res.status !== 200) {
        throw new Error(`Analysis API request failed with status ${res.status}`);
      }
      const result = await res.json() as any;

      const filename = `${fileDoc.hash}_dynamic.json`;
      const folder = path.dirname(fileDoc.reportPath);
      const reportPath = path.join(folder, filename);

      fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
      fileDoc.reportPath = reportPath;
      fileDoc.status = "done";
      await fileDoc.save();

      return result;
    } catch (err) {
      console.error("Error during dynamic analysis request:", err);
      fileDoc.status = "error";
      await fileDoc.save();
      throw err;
    }
    
  } catch (err) {
    console.error("Error in analyzeAndroidDynamic:", err);
    const fileDoc = await FileMeta.findOne({ hash: fileHash });
    if (fileDoc) {
      fileDoc.status = "error";
      await fileDoc.save();
    }
    throw err;
  }
}

// Optional CLI support
if (require.main === module) {
  const hash = process.argv[2];
  const mode = process.argv[3];
  if (!hash || !mode) {
    console.error("Usage: ts-node helper.ts <fileHash> <mode>");
    process.exit(1);
  }

  (async () => {
    try {
      if (mode === "ios-static") await analyzeIOSStatic(hash);
      else if (mode === "android-static") await analyzeAndroidStatic(hash);
      else if (mode === "android-dynamic") await analyzeAndroidDynamic(hash);
      else throw new Error(`Unknown mode: ${mode}`);
    } catch (err) {
      console.error(err);
    }
  })();
}
