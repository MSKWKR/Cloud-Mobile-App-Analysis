import mongoose, { Schema, Document } from "mongoose";

export interface FileMeta extends Document {
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  filename: string;
  analysisType: string;
  filePath: string;
  reportPath: string;
  hash: string;
  status: "pending" | "analyzing" | "done" | "error";
  taskId?: string;
  uploadTime?: Date;
}

const FileMetaSchema = new Schema<FileMeta>({
  user: { type: String, required: true },
  filename: { type: String, required: true },
  analysisType: { type: String, required: true },
  filePath: { type: String, required: true },
  reportPath: { type: String, required: true },
  hash: { type: String, required: true },
  status: { type: String, default: "pending", enum: ["pending", "analyzing", "done", "error"] },
  taskId: { type: String },
  uploadTime: { type: Date, default: Date.now },
});

// Optionally keep the compound index, but now per-user too
FileMetaSchema.index({ user: 1, hash: 1, analysisType: 1 }, { unique: true });

export const FileMeta = mongoose.model<FileMeta>("FileMeta", FileMetaSchema);
