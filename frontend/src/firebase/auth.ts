// src/firebase/auth.ts
import { auth } from "./config";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "firebase/auth";
import type { User } from "firebase/auth";

// Sign up
export const register = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password);

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