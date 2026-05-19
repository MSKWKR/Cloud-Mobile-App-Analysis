// src/components/AuthForms.tsx
import * as React from "react";
import { login, register } from "../firebase/auth";
import { auth } from "../firebase/config";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { UserCircle } from "lucide-react";

interface AuthFormsProps {
  /** Called when the user chooses to proceed without an account */
  onContinueAsGuest?: () => void;
}

/** Maps Firebase auth error codes to messages safe to show the user. */
const friendlyAuthError = (err: any, mode: "login" | "register"): string => {
  switch (err?.code) {
    case "auth/invalid-email":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection.";
    default:
      return mode === "login"
        ? "Could not sign in. Please try again."
        : "Could not create your account. Please try again.";
  }
};

const AuthForms: React.FC<AuthFormsProps> = ({ onContinueAsGuest }) => {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // Call backend to initialize user document (credits, etc.)
  const initializeUser = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;

    try {
      await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/initUser`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("initUser error:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      await initializeUser();
    } catch (err: any) {
      setError(friendlyAuthError(err, mode));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-col w-full space-y-4">
        <h2 className="text-white text-xl font-semibold text-center">
          {mode === "login" ? "Login" : "Register"}
        </h2>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <Button type="submit" disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Login" : "Register"}
        </Button>

        <p className="text-sm text-gray-400 text-center">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <Button
            type="button"
            variant="link"
            className="text-blue-500 p-0 underline"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Register" : "Login"}
          </Button>
        </p>
      </form>

      {/* Guest option */}
      {onContinueAsGuest && (
        <>
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-gray-700" />
            <span className="text-xs text-gray-500 shrink-0">or</span>
            <div className="flex-1 border-t border-gray-700" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 text-muted-foreground hover:text-foreground"
            onClick={onContinueAsGuest}
          >
            <UserCircle className="h-4 w-4" />
            Continue as Guest — no account needed
          </Button>

          <p className="text-xs text-gray-500 text-center">
            Upload once, pay per report. Your file and report are automatically deleted after 7 days.
          </p>
        </>
      )}
    </div>
  );
};

export default AuthForms;