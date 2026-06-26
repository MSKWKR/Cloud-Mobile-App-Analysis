// src/firebase/auth.ts
import { auth } from "./config";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged
} from "firebase/auth";
import type { User } from "firebase/auth";

// Sign up, then immediately send a verification email to the new account.
export const register = async (email: string, password: string) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  return cred;
};

// Re-send the verification email to the currently signed-in (unverified) user.
export const resendVerificationEmail = async () => {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
};

// Login
export const login = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password);

// Listen for auth changes
export const onUserStateChanged = (callback: (user: User | null) => void) =>
  onAuthStateChanged(auth, callback);

// Get the current user's ID token safely
export const getIdToken = async (): Promise<string | null> => {
  const user: User | null = auth.currentUser;
  if (!user) return null; // no user logged in
  return await user.getIdToken(); 
};