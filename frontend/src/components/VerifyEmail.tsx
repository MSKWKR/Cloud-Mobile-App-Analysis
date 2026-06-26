// src/components/VerifyEmail.tsx
import * as React from "react";
import { auth } from "../firebase/config";
import { resendVerificationEmail } from "../firebase/auth";
import { Button } from "./ui/button";
import { MailCheck, Loader2, RefreshCw, AlertCircle, Inbox } from "lucide-react";

interface VerifyEmailProps {
  email: string | null;
}

/**
 * Shown when a user is signed in but hasn't verified their email yet.
 * Firebase doesn't push the verified flag — the user clicks the link in
 * their inbox, then "I've verified" reloads to pick up the fresh status.
 */
const VerifyEmail: React.FC<VerifyEmailProps> = ({ email }) => {
  const [sending, setSending] = React.useState(false);
  const [resent, setResent] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [stillUnverified, setStillUnverified] = React.useState(false);

  const handleResend = async () => {
    setSending(true);
    setResent(false);
    try {
      await resendVerificationEmail();
      setResent(true);
    } catch (err) {
      console.error("Resend verification error:", err);
    } finally {
      setSending(false);
    }
  };

  const handleRecheck = async () => {
    setChecking(true);
    setStillUnverified(false);
    try {
      await auth.currentUser?.reload();
      if (auth.currentUser?.emailVerified) {
        // Full reload re-mints the ID token so the backend sees email_verified.
        window.location.reload();
      } else {
        setStillUnverified(true);
      }
    } catch (err) {
      console.error("Recheck verification error:", err);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
          <MailCheck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Verify your email</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{email ?? "your email"}</span>.
            Click it, then come back and continue.
          </p>
        </div>
      </div>

      {/* Prominent spam-folder notice — verification mail often lands there */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p className="text-sm text-foreground">
          <span className="font-medium">Don't see it?</span> The email can take a minute to
          arrive and often lands in your <span className="font-medium">spam or junk</span>{" "}
          folder — please check there before resending.
        </p>
      </div>

      {resent && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-foreground">Verification email sent again — check your inbox.</p>
        </div>
      )}

      {stillUnverified && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">
            Still not verified. Click the link in your email, then try again.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Button onClick={handleRecheck} disabled={checking} className="w-full">
          {checking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              I've verified my email
            </>
          )}
        </Button>

        <Button onClick={handleResend} disabled={sending} variant="outline" className="w-full">
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Resend verification email"
          )}
        </Button>

        <Button onClick={() => auth.signOut()} variant="ghost" className="w-full">
          Log out
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Wrong address? Log out and register again.
      </p>
    </div>
  );
};

export default VerifyEmail;
