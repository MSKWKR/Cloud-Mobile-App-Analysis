import React from "react";
import type { User } from "firebase/auth";

interface Props {
  user: User;
  refreshSignal?: number;
  onCreditsLoaded?: (credits: number) => void;
}

const UserCredits: React.FC<Props> = ({ user, refreshSignal, onCreditsLoaded }) => {
  const [credits, setCredits] = React.useState<number | null>(null);

  const fetchCredits = async () => {
    const token = await user.getIdToken();
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/getCredits`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) return;

      const data = await res.json();
      setCredits(data.credits);
      onCreditsLoaded?.(data.credits);
    } catch (err) {
      console.error("Error fetching credits:", err);
    }
  };

  React.useEffect(() => {
    fetchCredits();
  }, [user]);

  React.useEffect(() => {
    fetchCredits();
  }, [refreshSignal]);

  return (
    <span className="ml-3 text-green-400">
      {credits !== null ? `Credits: ${credits}` : "Loading credits..."}
    </span>
  );
};

export default UserCredits;