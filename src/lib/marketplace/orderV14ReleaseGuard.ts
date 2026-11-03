/**
 * V14R4A: dormant, source-only coordination gate.
 * Hard-disabled by source code until every relevant write path is protected.
 * The V14 refund migration remains unapplied, and legacy dispatch, settlement,
 * withdrawals and payment webhooks have not all been brought under the lock.
 * Turning this on before all paths are wired is NOT an approved safety release.
 */
import type { Prisma } from "@prisma/client";
import { lockMannaOrderAndDenyRefundIntent } from "@/lib/marketplace/orderMutationLock";

// Cannot be enabled with a runtime environment variable. The final release
// will require a separate reviewed source change after all writer audits.
const V14_GLOBAL_CROSS_PATH_RELEASED = false;

export function isV14OrderLockReleased(): boolean {
  return V14_GLOBAL_CROSS_PATH_RELEASED;
}

export async function guardV14OrderMutationIfReleased(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  if (!isV14OrderLockReleased()) return;
  // When the gate is explicitly released, missing migration/table fails closed.
  await lockMannaOrderAndDenyRefundIntent(tx, orderId);
}
