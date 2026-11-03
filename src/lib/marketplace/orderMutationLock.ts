/**
 * V14R3: source-only transaction-scoped order coordination primitive.
 * NOT YET WIRED. Do not invoke until OrderRefund migration is applied.
 * Every financial and dispatch write path must acquire the same order row
 * inside its own short Prisma interactive transaction, then re-read state
 * using THAT transaction before changing it. No provider network calls
 * inside the transaction.
 */
import type { Prisma } from "@prisma/client";

export class OrderRefundConcurrencyBlock extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderRefundConcurrencyBlock";
  }
}

export async function lockMannaOrderRow(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  if (typeof orderId !== "string" || !orderId.trim()) {
    throw new OrderRefundConcurrencyBlock("Order ID required for mutation lock.");
  }
  // PostgreSQL row lock is held until the surrounding transaction commits.
  // Parameterized SQL prevents an order ID from becoming executable SQL.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== orderId) {
    throw new OrderRefundConcurrencyBlock("Order missing or ambiguous under lock.");
  }
}

/**
 * For vendor readiness, dispatch, settlement and withdrawal mutations.
 * A failed/refunded/unknown refund record still blocks automatic actions;
 * an administrator must explicitly reconcile and release it later.
 */
export async function lockMannaOrderAndDenyRefundIntent(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<void> {
  await lockMannaOrderRow(tx, orderId);
  const existing = await tx.orderRefund.findUnique({
    where: { orderId },
    select: { id: true, status: true },
  });
  if (existing !== null) {
    throw new OrderRefundConcurrencyBlock(
      "Order has an existing refund intent; automatic mutation blocked."
    );
  }
}
