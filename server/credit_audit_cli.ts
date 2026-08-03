// server/credit_audit_cli.ts — run the credit reconciliation from a shell.
//
//   docker compose exec backend npx tsx credit_audit_cli.ts
//
// Same code path as the nightly job, so it is the fastest way to check the books
// after an incident (or to see what tomorrow's run would say) without exposing
// ADMIN_API_TOKEN over HTTP.

import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import serviceAccount from "./serviceAccountKey.json";
import { runCreditAudit } from "./credit_audit";

initializeApp({ credential: cert(serviceAccount as ServiceAccount) });

runCreditAudit("cli")
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    // Non-zero on anything critical so cron/CI can treat it as a failure.
    process.exit(summary.status === "error" || summary.criticalCount > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("credit-audit CLI failed:", err);
    process.exit(1);
  });
