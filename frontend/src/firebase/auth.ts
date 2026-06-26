// src/firebase/auth.ts
import { auth } from "./config";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged
} from "firebase/auth";
import type { User } from "firebase/auth";

// Rate-limit verification emails. Persisted so the cooldown survives the
// page reload on "I've verified" and counts the auto-send done at register.
const VERIFY_SENT_KEY = "verifyEmailLastSent";
export const VERIFY_COOLDOWN_MS = 60_000;

const markVerificationSent = () => {
  try {
    localStorage.setItem(VERIFY_SENT_KEY, Date.now().toString());
  } catch {
    /* localStorage unavailable — cooldown just won't persist */
  }
};

// Seconds remaining before another verification email may be sent (0 = ready).
export const verificationCooldownRemaining = (): number => {
  try {
    const last = Number(localStorage.getItem(VERIFY_SENT_KEY) || 0);
    if (!last) return 0;
    return Math.max(0, Math.ceil((VERIFY_COOLDOWN_MS - (Date.now() - last)) / 1000));
  } catch {
    return 0;
  }
};

// Sign up, then immediately send a verification email to the new account.
export const register = async (email: string, password: string) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  markVerificationSent();
  return cred;
};

// Re-send the verification email to the currently signed-in (unverified) user.
export const resendVerificationEmail = async () => {
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
    markVerificationSent();
  }
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