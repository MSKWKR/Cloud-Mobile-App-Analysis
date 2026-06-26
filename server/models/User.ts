import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Use Firebase uid as _id
  email: { type: String, required: true },
  // Credit balance lives in Firestore (users/{uid}.credits) — not stored here.
});

export const User = mongoose.model("User", UserSchema);
