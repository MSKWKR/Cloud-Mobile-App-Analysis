// src/App.tsx
import * as React from "react";
import AuthForms from "./components/AuthForms";
import BuyCredits from "./components/BuyCredits";
import FileUploader from "./components/FileUploader";
import GuestUploader from "./components/GuestUploader";
import UploadHistory from "./components/UploadHistory";
import UserCredits from "./components/UserCredits";
import { onUserStateChanged } from "./firebase/auth";
import { auth } from "./firebase/config";
import type { User } from "firebase/auth";
import { Button } from "./components/ui/button";
import ThemeToggle from "./components/ThemeToggle";

type View = "main" | "buy-credits";
type AuthMode = "auth" | "guest";

function App() {
  const [refresh, setRefresh] = React.useState(0);
  const [user, setUser] = React.useState<User | null>(null);
  const [view, setView] = React.useState<View>("main");
  const [currentCredits, setCurrentCredits] = React.useState(0);
  const [authMode, setAuthMode] = React.useState<AuthMode>("auth");

  React.useEffect(() => {
    const unsubscribe = onUserStateChanged(setUser);
    return () => unsubscribe();
  }, []);

  const handleUpload = () => setRefresh((prev) => prev + 1);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-100 via-background to-indigo-50 dark:from-[#070b16] dark:via-background dark:to-[#0c1226] p-4">
      <div className="w-full max-w-[760px] flex flex-col items-center gap-6 rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/50">

        {/* ── Unauthenticated ─────────────────────────────────────────── */}
        {!user && (
          <div className="flex justify-end w-full">
            <ThemeToggle />
          </div>
        )}

        {!user && authMode === "auth" && (
          <AuthForms onContinueAsGuest={() => setAuthMode("guest")} />
        )}

        {!user && authMode === "guest" && (
          <GuestUploader onSwitchToAuth={() => setAuthMode("auth")} />
        )}

        {/* ── Authenticated ────────────────────────────────────────────── */}
        {user && view === "buy-credits" && (
          <BuyCredits
            currentCredits={currentCredits}
            onBack={() => setView("main")}
          />
        )}

        {user && view === "main" && (
          <>
            <div className="flex justify-between w-full items-center">
              <div className="text-foreground font-medium flex items-center gap-2">
                Logged in as {user.email}
                <UserCredits
                  user={user}
                  refreshSignal={refresh}
                  onCreditsLoaded={setCurrentCredits}
                />
              </div>

              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Button variant="outline" onClick={() => setView("buy-credits")}>
                  Buy Credits
                </Button>
                <Button onClick={() => auth.signOut()}>
                  Logout
                </Button>
              </div>
            </div>

            <FileUploader onUpload={handleUpload} />
            <UploadHistory refreshSignal={refresh} />
          </>
        )}

      </div>
    </div>
  );
}

export default App;