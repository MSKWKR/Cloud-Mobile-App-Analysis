// src/components/BuyCredits.tsx
import * as React from "react";
import { auth } from "../firebase/config";
import { Button } from "./ui/button";

interface CreditPackage {
  id: string;
  credits: number;
  price: number; // in cents
  label?: string;
  popular?: boolean;
}

const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "starter", credits: 100, price: 500, label: "Starter" },
  { id: "pro", credits: 500, price: 2000, label: "Pro", popular: true },
  { id: "power", credits: 1500, price: 5000, label: "Power" },
  { id: "enterprise", credits: 5000, price: 15000, label: "Enterprise" },
];

interface BuyCreditsProps {
  currentCredits?: number;
  onBack?: () => void;
}

const BuyCredits: React.FC<BuyCreditsProps> = ({ currentCredits = 0, onBack }) => {
  const [selected, setSelected] = React.useState<string>("pro");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  const formatPrice = (cents: number) =>
    `$${(cents / 100).toFixed(2)}`;

  const pricePerCredit = (pkg: CreditPackage) =>
    ((pkg.price / pkg.credits) / 100).toFixed(3);

  const handlePurchase = async () => {
    const pkg = CREDIT_PACKAGES.find((p) => p.id === selected);
    if (!pkg) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("You must be logged in to purchase credits.");

      // Create a Stripe Checkout session via your backend
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/createCheckoutSession`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            packageId: pkg.id,
            credits: pkg.credits,
            priceInCents: pkg.price,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create checkout session.");
      }

      const { url } = await response.json();

      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        {onBack && (
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
          >
            ← Back
          </button>
        )}
        <h2 className="text-white text-xl font-semibold flex-1 text-center">
          Buy Credits
        </h2>
        {onBack && <div className="w-12" />}
      </div>

      {/* Current balance */}
      <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 flex justify-between items-center">
        <span className="text-gray-400 text-sm">Current balance</span>
        <span className="text-white font-semibold">
          {currentCredits.toLocaleString()} credits
        </span>
      </div>

      {/* Package grid */}
      <div className="grid grid-cols-2 gap-3">
        {CREDIT_PACKAGES.map((pkg) => {
          const isSelected = selected === pkg.id;
          return (
            <button
              key={pkg.id}
              onClick={() => setSelected(pkg.id)}
              className={`relative flex flex-col items-start p-4 rounded-lg border text-left transition-all duration-150 focus:outline-none ${
                isSelected
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
              }`}
            >
              {pkg.popular && (
                <span className="absolute -top-2.5 right-3 text-[11px] font-medium bg-blue-500 text-white px-2 py-0.5 rounded-full">
                  Most popular
                </span>
              )}
              <span
                className={`text-xs font-medium mb-2 ${
                  isSelected ? "text-blue-400" : "text-gray-400"
                }`}
              >
                {pkg.label}
              </span>
              <span className="text-white text-lg font-bold">
                {pkg.credits.toLocaleString()}
                <span className="text-gray-400 text-sm font-normal ml-1">
                  credits
                </span>
              </span>
              <span className="text-white font-semibold mt-1">
                {formatPrice(pkg.price)}
              </span>
              <span className="text-gray-500 text-xs mt-1">
                ${pricePerCredit(pkg)} per credit
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary */}
      {(() => {
        const pkg = CREDIT_PACKAGES.find((p) => p.id === selected);
        if (!pkg) return null;
        return (
          <div className="border border-white/10 rounded-lg px-4 py-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">
                {pkg.credits.toLocaleString()} credits
              </span>
              <span className="text-white">{formatPrice(pkg.price)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-white/10 pt-2">
              <span className="text-gray-400">New balance after purchase</span>
              <span className="text-green-400 font-medium">
                {(currentCredits + pkg.credits).toLocaleString()} credits
              </span>
            </div>
          </div>
        );
      })()}

      {/* Error / success */}
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      {success && <p className="text-green-400 text-sm text-center">{success}</p>}

      {/* CTA */}
      <Button
        onClick={handlePurchase}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Redirecting to checkout…" : "Continue to Payment"}
      </Button>

      <p className="text-gray-500 text-xs text-center">
        Payments are processed securely by Stripe. Credits are added to your
        account instantly after payment.
      </p>
    </div>
  );
};

export default BuyCredits;