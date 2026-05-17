import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Use Firebase uid as _id
  email: { type: String, required: true },
  credits: { type: Number, default: 10 },
});

export const User = mongoose.model("User", UserSchema);
