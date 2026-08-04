import { prisma } from "@/lib/prisma";
import { getKwikJobStatus } from "@/services/kwikWebhook";

function mapStatus(code: number) {
  switch (code) {
    case 0:
      return "CREATED";
    case 7:
      return "ASSIGNED";
    case 1:
      return "PICKED_UP";
    case 2:
      return "DELIVERED";
    case 3:
      return "FAILED";
    case 9:
      return "CANCELLED";
    default:
      return "IN_TRANSIT";
  }
}

export async function updateDeliveries() {
  const active = await prisma.delivery.findMany({
    where: {
      status: { in: ["CREATED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
      kwikTaskId: { not: null },
    },
  });

  for (const d of active) {
    const res = await getKwikJobStatus({
      jobId: d.kwikTaskId!,
      statusCheckUrl: d.kwikStatusCheckUrl ?? null,
    });

    const newStatus = mapStatus(res.job_status);

    await prisma.delivery.update({
      where: { id: d.id },
      data: {
        status: newStatus,
        kwikJobStatus: res.job_status,
        lastStatusCheckAt: new Date(),
        kwikRawResponse: JSON.parse(JSON.stringify(res.raw)) as never,
      },
    });

    if (newStatus === "DELIVERED") {
      await prisma.order.update({
        where: { id: d.orderId },
        data: { status: "DELIVERED" },
      });
    }
  }
}