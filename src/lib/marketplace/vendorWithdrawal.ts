import crypto from "node:crypto";
import type {
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  guardV14OrderMutationIfReleased,
  isV14OrderLockReleased,
} from "@/lib/marketplace/orderV14ReleaseGuard";
import { lockMannaOrderRow } from "@/lib/marketplace/orderMutationLock";
import {
  createPaystackTransferRecipient,
  initiatePaystackTransfer,
  PaystackTransferRequestError,
} from "@/lib/paystack/transfers";
import {
  notifyVendorWithdrawalFailed,
  notifyVendorWithdrawalRequested,
  notifyVendorWithdrawalSucceeded,
} from "@/lib/notifications/eventTriggers";

const AVAILABLE_STATUSES = [
  "AVAILABLE",
  "PENDING_PAYOUT",
];

const ACTIVE_WITHDRAWAL_STATUSES = [
  "INITIATING",
  "PROCESSING",
  "PROCESSING_UNKNOWN",
  "OTP_REQUIRED",
];

type TransferEventName =
  | "transfer.success"
  | "transfer.failed"
  | "transfer.reversed";

function withdrawalReference() {
  return (
    "manna_" +
    crypto
      .randomUUID()
      .replace(/-/g, "")
      .toLowerCase()
  );
}

function eventAmountMatches(
  amountNgn: number,
  amountKobo: number | null
) {
  if (
    amountKobo === null
  ) {
    return true;
  }

  return (
    Number.isInteger(amountKobo) &&
    amountKobo ===
      amountNgn * 100
  );
}

function deriveOrderStatus(
  statuses: string[]
) {
  if (statuses.length === 0) {
    return "NOT_SETTLED";
  }

  if (
    statuses.every(
      (status) => status === "PAID"
    )
  ) {
    return "PAID";
  }

  if (
    statuses.some(
      (status) =>
        status ===
        "WITHDRAWAL_PENDING"
    )
  ) {
    return "WITHDRAWAL_PENDING";
  }

  if (
    statuses.some((status) =>
      AVAILABLE_STATUSES.includes(
        status
      )
    )
  ) {
    return "AVAILABLE";
  }

  return statuses[0];
}

/**
 * Dormant until the global V14 release gate is reviewed and enabled.
 * Always acquire order locks in a deterministic order to limit deadlocks.
 * Refund intent blocks NEW reservations. Existing provider outcomes must
 * remain reconcilable, so their locks do not automatically deny refund intent.
 */
async function guardWithdrawalOrderSetIfReleased(
  tx: Prisma.TransactionClient,
  orderIds: string[],
  mode: "reserve" | "reconcile"
): Promise<void> {
  if (!isV14OrderLockReleased()) return;
  const ids = Array.from(new Set(orderIds)).sort();
  if (!ids.length) throw new Error("Withdrawal has no linked order rows.");
  for (const orderId of ids) {
    if (mode === "reserve") {
      await guardV14OrderMutationIfReleased(tx, orderId);
    } else {
      await lockMannaOrderRow(tx, orderId);
    }
  }
}

async function recomputeOrderStates(
  tx: Prisma.TransactionClient,
  orderIds: string[]
) {
  const uniqueOrderIds =
    Array.from(
      new Set(orderIds)
    );

  for (
    const orderId
    of uniqueOrderIds
  ) {
    const settlements =
      await tx.vendorSettlement.findMany({
        where: { orderId },
        select: {
          status: true,
          grossAmountNgn: true,
          commissionAmountNgn: true,
          payableAmountNgn: true,
        },
      });

    const vendorGrossAmountNgn =
      settlements.reduce(
        (sum, item) =>
          sum +
          item.grossAmountNgn,
        0
      );

    const mannaCommissionAmountNgn =
      settlements.reduce(
        (sum, item) =>
          sum +
          item.commissionAmountNgn,
        0
      );

    const vendorPayableAmountNgn =
      settlements.reduce(
        (sum, item) =>
          sum +
          item.payableAmountNgn,
        0
      );

    await tx.order.update({
      where: {
        id: orderId,
      },
      data: {
        settlementStatus:
          deriveOrderStatus(
            settlements.map(
              (item) =>
                item.status
            )
          ),
        vendorGrossAmountNgn,
        mannaCommissionAmountNgn,
        vendorPayableAmountNgn,
        settlementCalculatedAt:
          new Date(),
      },
    });
  }
}

async function releaseHeldWithdrawal(
  reference: string,
  reason: string
) {
  const withdrawal =
    await prisma.vendorWithdrawal.findUnique({
      where: { reference },
    });

  if (!withdrawal) {
    throw new Error(
      "Withdrawal not found."
    );
  }

  if (
    withdrawal.status ===
      "FAILED" ||
    withdrawal.status ===
      "REVERSED"
  ) {
    return withdrawal;
  }

  if (
    withdrawal.status ===
    "SUCCESS"
  ) {
    return withdrawal;
  }

  const linkedSettlements =
    await prisma.vendorSettlement.findMany({
      where: {
        vendorId:
          withdrawal.vendorId,
        payoutReference:
          withdrawal.reference,
        status:
          "WITHDRAWAL_PENDING",
      },
      select: {
        id: true,
        orderId: true,
        vendorOrderId: true,
      },
    });

  const orderIds =
    linkedSettlements.map(
      (item) => item.orderId
    );

  const vendorOrderIds =
    linkedSettlements.map(
      (item) =>
        item.vendorOrderId
    );

  await prisma.$transaction(
    async (tx) => {
      await guardWithdrawalOrderSetIfReleased(tx, orderIds, "reconcile");
      const balanceUpdate =
        await tx.vendor.updateMany({
          where: {
            id:
              withdrawal.vendorId,
            reservedWithdrawalNgn: {
              gte:
                withdrawal.amountNgn,
            },
          },
          data: {
            reservedWithdrawalNgn: {
              decrement:
                withdrawal.amountNgn,
            },
            payableBalanceNgn: {
              increment:
                withdrawal.amountNgn,
            },
          },
        });

      if (
        balanceUpdate.count !== 1
      ) {
        throw new Error(
          "Withdrawal balance could not be safely released."
        );
      }

      await tx.vendorWithdrawal.update({
        where: {
          id: withdrawal.id,
        },
        data: {
          status: "FAILED",
          failureReason: reason,
          failedAt: new Date(),
        },
      });

      await tx.vendorSettlement.updateMany({
        where: {
          id: {
            in:
              linkedSettlements.map(
                (item) => item.id
              ),
          },
        },
        data: {
          status: "AVAILABLE",
          payoutReference: null,
          paidAt: null,
        },
      });

      if (
        vendorOrderIds.length >
        0
      ) {
        await tx.vendorOrder.updateMany({
          where: {
            id: {
              in:
                vendorOrderIds,
            },
          },
          data: {
            settlementStatus:
              "AVAILABLE",
            settlementPaidAt:
              null,
          },
        });
      }

      await tx.vendorLedgerEntry.upsert({
        where: {
          idempotencyKey:
            `vendor-ledger:withdrawal-release:${withdrawal.reference}`,
        },
        update: {},
        create: {
          vendorId:
            withdrawal.vendorId,
          entryType:
            "WITHDRAWAL_RELEASE",
          direction: "CREDIT",
          amountNgn:
            withdrawal.amountNgn,
          idempotencyKey:
            `vendor-ledger:withdrawal-release:${withdrawal.reference}`,
          description:
            "Reserved vendor withdrawal funds were restored to available balance.",
          metadata: {
            withdrawalId:
              withdrawal.id,
            reference:
              withdrawal.reference,
            reason,
          },
        },
      });

      await recomputeOrderStates(
        tx,
        orderIds
      );
    }
  );

  await notifyVendorWithdrawalFailed(
    withdrawal.vendorId,
    withdrawal.amountNgn,
    withdrawal.reference,
    reason
  ).catch(() => undefined);

  return prisma.vendorWithdrawal.findUnique({
    where: { reference },
  });
}

export async function requestVendorWithdrawal(
  input: {
    vendorId: string;
    actorUserId: string;
  }
) {
  const vendor =
    await prisma.vendor.findUnique({
      where: {
        id: input.vendorId,
      },
      select: {
        id: true,
        displayName: true,
        payableBalanceNgn: true,
        reservedWithdrawalNgn: true,
        minimumPayoutNgn: true,
        bankAccounts: {
          where: {
            isDefault: true,
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            bankName: true,
            bankCode: true,
            accountNumber: true,
            accountName: true,
            verificationStatus: true,
            paystackRecipientCode: true,
          },
        },
      },
    });

  if (!vendor) {
    throw new Error(
      "Vendor not found."
    );
  }

  if (
    vendor.reservedWithdrawalNgn >
    0
  ) {
    throw new Error(
      "A withdrawal is already being processed for this vendor."
    );
  }

  const activeWithdrawal =
    await prisma.vendorWithdrawal.findFirst({
      where: {
        vendorId: vendor.id,
        status: {
          in:
            ACTIVE_WITHDRAWAL_STATUSES,
        },
      },
      select: {
        id: true,
      },
    });

  if (activeWithdrawal) {
    throw new Error(
      "A withdrawal is already being processed for this vendor."
    );
  }

  const settlements =
    await prisma.vendorSettlement.findMany({
      where: {
        vendorId: vendor.id,
        status: {
          in:
            AVAILABLE_STATUSES,
        },
      },
      orderBy: {
        eligibleAt: "asc",
      },
      select: {
        id: true,
        orderId: true,
        vendorOrderId: true,
        payableAmountNgn: true,
      },
    });

  const amountNgn =
    settlements.reduce(
      (sum, item) =>
        sum +
        item.payableAmountNgn,
      0
    );

  if (amountNgn <= 0) {
    throw new Error(
      "There is no available vendor balance to withdraw."
    );
  }

  if (
    vendor.payableBalanceNgn !==
    amountNgn
  ) {
    throw new Error(
      "Vendor balance needs reconciliation before withdrawal."
    );
  }

  if (
    amountNgn <
    vendor.minimumPayoutNgn
  ) {
    throw new Error(
      "Available balance is below the vendor minimum payout amount."
    );
  }

  const bank =
    vendor.bankAccounts[0];

  if (!bank) {
    throw new Error(
      "A default payout bank account is required."
    );
  }

  if (
    bank.verificationStatus !==
    "APPROVED"
  ) {
    throw new Error(
      "The default payout bank account must be approved before withdrawal."
    );
  }

  if (!bank.bankCode) {
    throw new Error(
      "The default payout bank account is missing its bank code."
    );
  }

  const reference =
    withdrawalReference();

  const orderIds =
    Array.from(
      new Set(
        settlements.map(
          (item) => item.orderId
        )
      )
    );

  const vendorOrderIds =
    settlements.map(
      (item) =>
        item.vendorOrderId
    );

  const withdrawal =
    await prisma.$transaction(
      async (tx) => {
        await guardWithdrawalOrderSetIfReleased(tx, orderIds, "reserve");
        if (isV14OrderLockReleased()) {
          // The initial selection was outside the transaction: re-read under
          // every order lock and fail if an eligible settlement was added,
          // removed, paid, or changed before reservation.
          const current = await tx.vendorSettlement.findMany({
            where: { vendorId: vendor.id, status: { in: AVAILABLE_STATUSES } },
            select: { id: true, orderId: true, vendorOrderId: true, payableAmountNgn: true },
          });
          const expected = new Map(settlements.map(item => [item.id, item]));
          if (current.length !== expected.size || current.some(item => {
            const prior = expected.get(item.id);
            return !prior || prior.orderId !== item.orderId ||
              prior.vendorOrderId !== item.vendorOrderId ||
              prior.payableAmountNgn !== item.payableAmountNgn;
          })) {
            throw new Error("Eligible settlements changed before withdrawal reservation.");
          }
        }
        const balanceUpdate =
          await tx.vendor.updateMany({
            where: {
              id: vendor.id,
              reservedWithdrawalNgn:
                0,
              payableBalanceNgn:
                amountNgn,
            },
            data: {
              payableBalanceNgn: {
                decrement:
                  amountNgn,
              },
              reservedWithdrawalNgn: {
                increment:
                  amountNgn,
              },
            },
          });

        if (
          balanceUpdate.count !==
          1
        ) {
          throw new Error(
            "Vendor balance changed before the withdrawal could be reserved."
          );
        }

        const created =
          await tx.vendorWithdrawal.create({
            data: {
              vendorId: vendor.id,
              bankAccountId:
                bank.id,
              amountNgn,
              currency: "NGN",
              status:
                "INITIATING",
              reference,
              requestedByUserId:
                input.actorUserId,
              metadata: {
                settlementIds:
                  settlements.map(
                    (item) =>
                      item.id
                  ),
                orderIds,
              },
            },
          });

        await tx.vendorSettlement.updateMany({
          where: {
            id: {
              in:
                settlements.map(
                  (item) =>
                    item.id
                ),
            },
          },
          data: {
            status:
              "WITHDRAWAL_PENDING",
            payoutReference:
              reference,
          },
        });

        await tx.vendorOrder.updateMany({
          where: {
            id: {
              in:
                vendorOrderIds,
            },
          },
          data: {
            settlementStatus:
              "WITHDRAWAL_PENDING",
          },
        });

        await tx.vendorLedgerEntry.upsert({
          where: {
            idempotencyKey:
              `vendor-ledger:withdrawal-hold:${reference}`,
          },
          update: {},
          create: {
            vendorId: vendor.id,
            entryType:
              "WITHDRAWAL_HOLD",
            direction: "HOLD",
            amountNgn,
            idempotencyKey:
              `vendor-ledger:withdrawal-hold:${reference}`,
            description:
              "Vendor balance reserved for Paystack transfer.",
            metadata: {
              withdrawalId:
                created.id,
              reference,
            },
          },
        });

        await recomputeOrderStates(
          tx,
          orderIds
        );

        return created;
      }
    );

  await notifyVendorWithdrawalRequested(
    vendor.id,
    amountNgn,
    reference
  ).catch(() => undefined);

  let recipientCode =
    bank.paystackRecipientCode;

  if (!recipientCode) {
    try {
      const recipient =
        await createPaystackTransferRecipient({
          name:
            bank.accountName,
          accountNumber:
            bank.accountNumber,
          bankCode:
            bank.bankCode,
        });

      recipientCode =
        recipient.recipientCode;

      await prisma.vendorBankAccount.update({
        where: {
          id: bank.id,
        },
        data: {
          paystackRecipientCode:
            recipientCode,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to prepare transfer recipient.";

      await releaseHeldWithdrawal(
        reference,
        message
      );

      throw error;
    }
  }

  try {
    const transfer =
      await initiatePaystackTransfer({
        amountNgn,
        recipientCode,
        reference,
        reason:
          `Manna vendor withdrawal - ${vendor.displayName}`,
      });

    const status =
      transfer.status === "otp"
        ? "OTP_REQUIRED"
        : "PROCESSING";

    return await prisma.vendorWithdrawal.update({
      where: {
        id: withdrawal.id,
      },
      data: {
        status,
        recipientCode,
        transferCode:
          transfer.transferCode,
        processingAt:
          new Date(),
        metadata: {
          settlementIds:
            settlements.map(
              (item) => item.id
            ),
          orderIds,
          providerStatus:
            transfer.status,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof
        PaystackTransferRequestError &&
      error.uncertain
    ) {
      return prisma.vendorWithdrawal.update({
        where: {
          id: withdrawal.id,
        },
        data: {
          status:
            "PROCESSING_UNKNOWN",
          recipientCode,
          processingAt:
            new Date(),
          failureReason:
            "Transfer outcome is unknown and requires reconciliation before funds can be released.",
        },
      });
    }

    const message =
      error instanceof Error
        ? error.message
        : "Transfer initiation failed.";

    await releaseHeldWithdrawal(
      reference,
      message
    );

    throw error;
  }
}

export async function applyVendorWithdrawalTransferEvent(
  input: {
    event:
      TransferEventName;
    reference: string;
    transferCode?: string | null;
    amountKobo?: number | null;
  }
) {
  const withdrawal =
    await prisma.vendorWithdrawal.findUnique({
      where: {
        reference:
          input.reference,
      },
    });

  if (!withdrawal) {
    return {
      handled: false,
      reason:
        "WITHDRAWAL_NOT_FOUND",
    };
  }

  if (
    !eventAmountMatches(
      withdrawal.amountNgn,
      input.amountKobo ?? null
    )
  ) {
    throw new Error(
      "Paystack transfer amount does not match the reserved vendor withdrawal."
    );
  }

  if (
    input.event ===
    "transfer.success"
  ) {
    if (
      withdrawal.status ===
      "SUCCESS"
    ) {
      return {
        handled: true,
        idempotent: true,
      };
    }

    if (
      withdrawal.status ===
      "REVERSED"
    ) {
      return {
        handled: true,
        idempotent: true,
      };
    }

    const linkedSettlements =
      await prisma.vendorSettlement.findMany({
        where: {
          vendorId:
            withdrawal.vendorId,
          payoutReference:
            withdrawal.reference,
        },
        select: {
          id: true,
          orderId: true,
          vendorOrderId: true,
        },
      });

    const orderIds =
      linkedSettlements.map(
        (item) => item.orderId
      );

    await prisma.$transaction(
      async (tx) => {
        await guardWithdrawalOrderSetIfReleased(tx, orderIds, "reconcile");
        const balanceUpdate =
          await tx.vendor.updateMany({
            where: {
              id:
                withdrawal.vendorId,
              reservedWithdrawalNgn: {
                gte:
                  withdrawal.amountNgn,
              },
            },
            data: {
              reservedWithdrawalNgn: {
                decrement:
                  withdrawal.amountNgn,
              },
              lifetimePaidOutNgn: {
                increment:
                  withdrawal.amountNgn,
              },
            },
          });

        if (
          balanceUpdate.count !==
          1
        ) {
          throw new Error(
            "Reserved withdrawal balance could not be finalized."
          );
        }

        await tx.vendorWithdrawal.update({
          where: {
            id: withdrawal.id,
          },
          data: {
            status: "SUCCESS",
            transferCode:
              input.transferCode ??
              withdrawal.transferCode,
            succeededAt:
              new Date(),
            failureReason: null,
          },
        });

        await tx.vendorSettlement.updateMany({
          where: {
            id: {
              in:
                linkedSettlements.map(
                  (item) => item.id
                ),
            },
          },
          data: {
            status: "PAID",
            paidAt:
              new Date(),
          },
        });

        await tx.vendorOrder.updateMany({
          where: {
            id: {
              in:
                linkedSettlements.map(
                  (item) =>
                    item.vendorOrderId
                ),
            },
          },
          data: {
            settlementStatus:
              "PAID",
            settlementPaidAt:
              new Date(),
          },
        });

        await tx.vendorLedgerEntry.upsert({
          where: {
            idempotencyKey:
              `vendor-ledger:withdrawal-success:${withdrawal.reference}`,
          },
          update: {},
          create: {
            vendorId:
              withdrawal.vendorId,
            entryType:
              "WITHDRAWAL_SUCCESS",
            direction: "DEBIT",
            amountNgn:
              withdrawal.amountNgn,
            idempotencyKey:
              `vendor-ledger:withdrawal-success:${withdrawal.reference}`,
            description:
              "Paystack confirmed vendor withdrawal success.",
            metadata: {
              withdrawalId:
                withdrawal.id,
              reference:
                withdrawal.reference,
              transferCode:
                input.transferCode ??
                withdrawal.transferCode,
            },
          },
        });

        await recomputeOrderStates(
          tx,
          orderIds
        );
      }
    );

    await notifyVendorWithdrawalSucceeded(
      withdrawal.vendorId,
      withdrawal.amountNgn,
      withdrawal.reference
    ).catch(() => undefined);

    return {
      handled: true,
      idempotent: false,
    };
  }

  if (
    input.event ===
    "transfer.failed"
  ) {
    if (
      withdrawal.status ===
        "FAILED" ||
      withdrawal.status ===
        "REVERSED" ||
      withdrawal.status ===
        "SUCCESS"
    ) {
      return {
        handled: true,
        idempotent: true,
      };
    }

    await releaseHeldWithdrawal(
      withdrawal.reference,
      "Paystack reported that the vendor transfer failed."
    );

    return {
      handled: true,
      idempotent: false,
    };
  }

  if (
    withdrawal.status ===
    "REVERSED"
  ) {
    return {
      handled: true,
      idempotent: true,
    };
  }

  if (
    withdrawal.status ===
    "FAILED"
  ) {
    await prisma.vendorWithdrawal.update({
      where: {
        id: withdrawal.id,
      },
      data: {
        status:
          "REVERSED",
        reversedAt:
          new Date(),
        transferCode:
          input.transferCode ??
          withdrawal.transferCode,
      },
    });

    return {
      handled: true,
      idempotent: true,
    };
  }

  const linkedSettlements =
    await prisma.vendorSettlement.findMany({
      where: {
        vendorId:
          withdrawal.vendorId,
        payoutReference:
          withdrawal.reference,
      },
      select: {
        id: true,
        orderId: true,
        vendorOrderId: true,
      },
    });

  const orderIds =
    linkedSettlements.map(
      (item) => item.orderId
    );

  await prisma.$transaction(
    async (tx) => {
      await guardWithdrawalOrderSetIfReleased(tx, orderIds, "reconcile");
      const vendor =
        await tx.vendor.findUnique({
          where: {
            id:
              withdrawal.vendorId,
          },
          select: {
            reservedWithdrawalNgn:
              true,
            payableBalanceNgn:
              true,
            lifetimePaidOutNgn:
              true,
          },
        });

      if (!vendor) {
        throw new Error(
          "Vendor not found while reversing withdrawal."
        );
      }

      const wasSuccessful =
        withdrawal.status ===
        "SUCCESS";

      if (wasSuccessful) {
        await tx.vendor.update({
          where: {
            id:
              withdrawal.vendorId,
          },
          data: {
            payableBalanceNgn: {
              increment:
                withdrawal.amountNgn,
            },
            lifetimePaidOutNgn:
              Math.max(
                0,
                vendor.lifetimePaidOutNgn -
                  withdrawal.amountNgn
              ),
          },
        });
      } else {
        if (
          vendor.reservedWithdrawalNgn <
          withdrawal.amountNgn
        ) {
          throw new Error(
            "Reserved withdrawal balance is inconsistent during reversal."
          );
        }

        await tx.vendor.update({
          where: {
            id:
              withdrawal.vendorId,
          },
          data: {
            reservedWithdrawalNgn: {
              decrement:
                withdrawal.amountNgn,
            },
            payableBalanceNgn: {
              increment:
                withdrawal.amountNgn,
            },
          },
        });
      }

      await tx.vendorWithdrawal.update({
        where: {
          id: withdrawal.id,
        },
        data: {
          status: "REVERSED",
          reversedAt:
            new Date(),
          transferCode:
            input.transferCode ??
            withdrawal.transferCode,
          failureReason:
            "Paystack reversed the transfer and the vendor balance was restored.",
        },
      });

      await tx.vendorSettlement.updateMany({
        where: {
          id: {
            in:
              linkedSettlements.map(
                (item) => item.id
              ),
          },
        },
        data: {
          status: "AVAILABLE",
          payoutReference: null,
          paidAt: null,
        },
      });

      await tx.vendorOrder.updateMany({
        where: {
          id: {
            in:
              linkedSettlements.map(
                (item) =>
                  item.vendorOrderId
              ),
          },
        },
        data: {
          settlementStatus:
            "AVAILABLE",
          settlementPaidAt:
            null,
        },
      });

      await tx.vendorLedgerEntry.upsert({
        where: {
          idempotencyKey:
            `vendor-ledger:withdrawal-reversal:${withdrawal.reference}`,
        },
        update: {},
        create: {
          vendorId:
            withdrawal.vendorId,
          entryType:
            "WITHDRAWAL_RELEASE",
          direction: "CREDIT",
          amountNgn:
            withdrawal.amountNgn,
          idempotencyKey:
            `vendor-ledger:withdrawal-reversal:${withdrawal.reference}`,
          description:
            "Paystack reversed a vendor withdrawal and funds were restored.",
          metadata: {
            withdrawalId:
              withdrawal.id,
            reference:
              withdrawal.reference,
          },
        },
      });

      await recomputeOrderStates(
        tx,
        orderIds
      );
    }
  );

  await notifyVendorWithdrawalFailed(
    withdrawal.vendorId,
    withdrawal.amountNgn,
    withdrawal.reference,
    "Transfer reversed; funds were restored to your available balance."
  ).catch(() => undefined);

  return {
    handled: true,
    idempotent: false,
  };
}
