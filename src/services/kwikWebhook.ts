// src/services/kwikWebhook.ts
import axios from "axios";
import https from "https";

const allowInsecureTls =
  (process.env.KWIK_INSECURE_TLS ?? "false").toLowerCase() === "true";

const httpsAgent = allowInsecureTls
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

let accessToken: string | null = null;
let accessTokenExpiry = 0;

let cookieHeader: string | null = null;
let cookieExpiry = 0;

type JsonRecord = Record<string, unknown>;
type KwikApiResponse = JsonRecord;

type NormalizedKwikStatus = {
  job_status: number;
  unique_order_id: string | null;
  tracking_url: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function lagosNowPlus(minutes: number) {
  const d = new Date(Date.now() + minutes * 60 * 1000);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get(
    "minute"
  )}:${get("second")}`;
}

function mustEnv(name: string, val: string | undefined) {
  if (!val) throw new Error(`Missing ${name} in .env`);
  return val;
}

function resetSession() {
  accessToken = null;
  accessTokenExpiry = 0;
  cookieHeader = null;
  cookieExpiry = 0;
}

function looksLikeCannotMethodText(value: unknown) {
  if (typeof value === "string") {
    return (
      value.startsWith("Cannot ") ||
      value.includes("Cannot POST") ||
      value.includes("Cannot GET")
    );
  }

  if (isRecord(value)) {
    const s = JSON.stringify(value);
    return s.includes("Cannot POST") || s.includes("Cannot GET") || s.includes("Cannot ");
  }

  return false;
}

async function loginWithEmailPassword(force = false) {
  const BASE = mustEnv("KWIK_BASE_URL", process.env.KWIK_BASE_URL);
  const DOMAIN_NAME = mustEnv("KWIK_DOMAIN_NAME", process.env.KWIK_DOMAIN_NAME);
  const EMAIL = mustEnv("KWIK_EMAIL", process.env.KWIK_EMAIL);
  const PASSWORD = mustEnv("KWIK_PASSWORD", process.env.KWIK_PASSWORD);

  const now = Date.now();
  const tokenOk = accessToken && now < accessTokenExpiry;
  const cookieOk = cookieHeader && now < cookieExpiry;

  if (!force && tokenOk && cookieOk) return;

  const res = await axios.post(
    `${BASE}/vendor_login`,
    {
      domain_name: DOMAIN_NAME,
      email: EMAIL,
      password: PASSWORD,
      api_login: 1,
    },
    {
      validateStatus: () => true,
      httpsAgent,
    }
  );

  const body = asRecord(res.data);
  const ok = body.status === 200 || body.status === 201;
  if (!ok) throw new Error(`KWIK vendor_login failed: ${JSON.stringify(body)}`);

  const bodyData = asRecord(body.data);
  const token = toStringOrNull(bodyData.access_token ?? body.access_token);
  if (!token) {
    throw new Error(`KWIK vendor_login missing access_token: ${JSON.stringify(body)}`);
  }

  const setCookie = res.headers["set-cookie"];
  if (Array.isArray(setCookie) && setCookie.length > 0) {
    cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
    cookieExpiry = now + 25 * 60 * 1000;
  } else {
    cookieHeader = null;
    cookieExpiry = now + 5 * 60 * 1000;
  }

  accessToken = token;
  accessTokenExpiry = now + 25 * 60 * 1000;
}

async function kwikPost(
  path: string,
  body: JsonRecord,
  retry = true
): Promise<KwikApiResponse> {
  const BASE = mustEnv("KWIK_BASE_URL", process.env.KWIK_BASE_URL);
  const DOMAIN_NAME = mustEnv("KWIK_DOMAIN_NAME", process.env.KWIK_DOMAIN_NAME);

  await loginWithEmailPassword(false);

  const res = await axios.post(
    `${BASE}${path}`,
    {
      ...body,
      domain_name: DOMAIN_NAME,
      access_token: accessToken,
    },
    {
      headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
      validateStatus: () => true,
      httpsAgent,
    }
  );

  const data = asRecord(res.data);

  if (data.status === 101 && retry) {
    resetSession();
    await loginWithEmailPassword(true);
    return kwikPost(path, body, false);
  }

  return data;
}

async function kwikGet(
  path: string,
  params: JsonRecord,
  retry = true
): Promise<KwikApiResponse> {
  const BASE = mustEnv("KWIK_BASE_URL", process.env.KWIK_BASE_URL);
  const DOMAIN_NAME = mustEnv("KWIK_DOMAIN_NAME", process.env.KWIK_DOMAIN_NAME);

  await loginWithEmailPassword(false);

  const res = await axios.get(`${BASE}${path}`, {
    params: {
      ...params,
      domain_name: DOMAIN_NAME,
      access_token: accessToken,
    },
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    validateStatus: () => true,
    httpsAgent,
  });

  const data = asRecord(res.data);

  if (data.status === 101 && retry) {
    resetSession();
    await loginWithEmailPassword(true);
    return kwikGet(path, params, false);
  }

  return data;
}

// ✅ Call an absolute status-check URL returned by KWIK (job_status_check_link)
async function kwikGetAbsoluteUrl(url: string, retry = true): Promise<KwikApiResponse> {
  await loginWithEmailPassword(false);

  const res = await axios.get(url, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    validateStatus: () => true,
    httpsAgent,
  });

  const data = asRecord(res.data);

  if (data.status === 101 && retry) {
    resetSession();
    await loginWithEmailPassword(true);
    return kwikGetAbsoluteUrl(url, false);
  }

  return data;
}

function normalizeJobStatus(res: unknown): NormalizedKwikStatus | null {
  const root = asRecord(res);
  const payload = asRecord(root.data ?? root);
  const job = asRecord(payload.job);
  const nestedData = asRecord(payload.data);
  const tracking = asRecord(payload.tracking);

  const jobStatusRaw =
    payload.job_status ??
    payload.jobStatus ??
    payload.status ??
    job.job_status ??
    job.status ??
    nestedData.job_status ??
    null;

  const job_status = Number(jobStatusRaw);
  if (!Number.isFinite(job_status)) return null;

  const uniqueOrderId =
    payload.unique_order_id ??
    payload.uniqueOrderId ??
    job.unique_order_id ??
    job.uniqueOrderId ??
    nestedData.unique_order_id ??
    null;

  const trackingUrl =
    payload.result_tracking_link ??
    payload.tracking_url ??
    payload.trackingUrl ??
    tracking.url ??
    job.result_tracking_link ??
    job.tracking_url ??
    nestedData.result_tracking_link ??
    null;

  return {
    job_status,
    unique_order_id: toStringOrNull(uniqueOrderId),
    tracking_url: toStringOrNull(trackingUrl),
  };
}

/**
 * ✅ Now supports preferred polling via KWIK-provided statusCheckUrl.
 */
export async function getKwikJobStatus(args: { jobId: string; statusCheckUrl?: string | null }) {
  const { jobId, statusCheckUrl } = args;
  if (!jobId) throw new Error("jobId is required");

  if (statusCheckUrl) {
    const res = await kwikGetAbsoluteUrl(statusCheckUrl);
    if (!looksLikeCannotMethodText(res)) {
      const norm = normalizeJobStatus(res);
      if (norm) return { ...norm, raw: res, usedEndpoint: `GET ${statusCheckUrl}` };
    }
  }

  const candidates: Array<{ method: "GET" | "POST"; path: string }> = [
    { method: "GET", path: "/task_status" },
    { method: "GET", path: "/job_status" },
    { method: "GET", path: "/get_task_status" },
    { method: "GET", path: "/get_job_status" },
    { method: "POST", path: "/task_status" },
    { method: "POST", path: "/job_status" },
    { method: "POST", path: "/get_task_status" },
    { method: "POST", path: "/get_job_status" },
  ];

  const errors: string[] = [];

  for (const candidate of candidates) {
    const res =
      candidate.method === "GET"
        ? await kwikGet(candidate.path, { job_id: jobId }).catch((error: unknown) => {
            errors.push(`${candidate.method} ${candidate.path} threw: ${getMessage(error)}`);
            return null;
          })
        : await kwikPost(candidate.path, { job_id: jobId }).catch((error: unknown) => {
            errors.push(`${candidate.method} ${candidate.path} threw: ${getMessage(error)}`);
            return null;
          });

    if (!res) continue;

    if (looksLikeCannotMethodText(res)) {
      errors.push(`${candidate.method} ${candidate.path} not allowed: ${JSON.stringify(res)}`);
      continue;
    }

    if (res.status !== 200) {
      errors.push(`${candidate.method} ${candidate.path} failed: ${JSON.stringify(res)}`);
      continue;
    }

    const norm = normalizeJobStatus(res);
    if (!norm) {
      errors.push(`${candidate.method} ${candidate.path} missing job_status`);
      continue;
    }

    return { ...norm, raw: res, usedEndpoint: `${candidate.method} ${candidate.path}` };
  }

  throw new Error(`KWIK status check failed. Tried: ${errors.join(" | ")}`);
}

export async function createKwikDelivery(order: {
  orderId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  city: string;
  state: string;
  deliveryLat: number;
  deliveryLng: number;
  amountNgn?: number;
  vehicleId: number; // ✅ dynamic (bike/suv/van)
}) {
  const vendorId = Number(mustEnv("KWIK_VENDOR_ID", process.env.KWIK_VENDOR_ID));
  const paymentMethod = Number(mustEnv("KWIK_PAYMENT_METHOD", process.env.KWIK_PAYMENT_METHOD));
  const timezone = Number(mustEnv("KWIK_TIMEZONE", process.env.KWIK_TIMEZONE));
  const sareaId = String(mustEnv("KWIK_SAREA_ID", process.env.KWIK_SAREA_ID));
  const formId = Number(mustEnv("KWIK_FORM_ID", process.env.KWIK_FORM_ID));
  const userId = Number(mustEnv("KWIK_USER_ID", process.env.KWIK_USER_ID));
  const teamIdRaw = process.env.KWIK_TEAM_ID;

  if (!Number.isFinite(order.vehicleId) || order.vehicleId <= 0) {
    throw new Error(`Invalid vehicleId passed to KWIK: ${order.vehicleId}`);
  }

  const whAddress = mustEnv("WAREHOUSE_ADDRESS", process.env.WAREHOUSE_ADDRESS);
  const whLat = Number(process.env.WAREHOUSE_LAT);
  const whLng = Number(process.env.WAREHOUSE_LNG);

  if (!Number.isFinite(whLat) || !Number.isFinite(whLng)) {
    throw new Error("Invalid WAREHOUSE_LAT/LNG");
  }

  if (!Number.isFinite(order.deliveryLat) || !Number.isFinite(order.deliveryLng)) {
    throw new Error("deliveryLat/deliveryLng are required");
  }

  const time = lagosNowPlus(10);

  const pickups = [
    {
      address: whAddress,
      name: "Manna Warehouse",
      latitude: whLat,
      longitude: whLng,
      time,
      phone: process.env.WAREHOUSE_PHONE ?? order.customerPhone,
      email: process.env.COMPANY_EMAIL ?? "",
    },
  ];

  const deliveries = [
    {
      address: `${order.address}, ${order.city}, ${order.state}`,
      name: order.customerName,
      latitude: order.deliveryLat,
      longitude: order.deliveryLng,
      time,
      phone: order.customerPhone,
      email: "",
      has_return_task: false,
      is_package_insured: 0,
      is_task_otp_required: 0,
    },
  ];

  const pay = await kwikPost("/send_payment_for_task", {
    vendor_id: vendorId,
    user_id: userId,
    form_id: formId,
    auto_assignment: 1,
    layout_type: 0,
    has_pickup: 1,
    has_delivery: 1,
    is_multiple_tasks: 1,
    is_schedule_task: 0,
    payment_method: paymentMethod,
    vehicle_id: order.vehicleId, // ✅ use dynamic vehicle
    pickups,
    deliveries,
    is_loader_required: 0,
    loaders_amount: 0,
    loaders_count: 0,
    delivery_instruction: "",
    delivery_images: "",
    is_cod_job: 0,
    parcel_amount: 0,
  });

  if (pay.status !== 200) {
    throw new Error(`KWIK send_payment_for_task failed: ${JSON.stringify(pay)}`);
  }

  const payData = asRecord(pay.data);
  const perTaskCostRaw = payData.per_task_cost ?? pay.per_task_cost ?? null;
  const perTaskCost = toStringOrNull(perTaskCostRaw) ?? "";
  if (!perTaskCost) throw new Error(`Missing per_task_cost: ${JSON.stringify(pay)}`);

  const bill = await kwikPost("/get_bill_breakdown", {
    user_id: userId,
    form_id: formId,
    amount: perTaskCost,
    insurance_amount: payData.insurance_amount ?? 0,
    total_no_of_tasks: payData.total_no_of_tasks ?? 1,
    total_service_charge: payData.total_service_charge ?? 0,
    credits: 0,
    promo_value: null,
    benefit_type: null,
    is_loader_required: payData.is_loader_required ?? 0,
    loaders_amount: payData.loaders_amount ?? 0,
    loaders_count: payData.loaders_count ?? 0,
    delivery_instruction: payData.delivery_instruction ?? "",
    vehicle_id: order.vehicleId,
    delivery_images: payData.delivery_images ?? "",
    is_cod_job: 0,
    parcel_amount: 0,
    delivery_charge_by_buyer: 1,
  });

  const billData = asRecord(bill.data);
  const surgeCost = toNumber(billData.SURGE_PRICING, 0);
  const surgeType = toNumber(billData.SURGE_TYPE, 0);

  const create = await kwikPost("/create_task_via_vendor", {
    vendor_id: vendorId,
    is_multiple_tasks: 1,
    timezone,
    has_pickup: 1,
    has_delivery: 1,
    layout_type: 0,
    auto_assignment: 1,
    ...(teamIdRaw ? { team_id: Number(teamIdRaw) } : {}), // ✅ don't send "" (KWIK can reject)
    pickups,
    deliveries,
    insurance_amount: payData.insurance_amount ?? 0,
    total_no_of_tasks: payData.total_no_of_tasks ?? 1,
    total_service_charge: payData.total_service_charge ?? 0,
    payment_method: paymentMethod,
    amount: perTaskCost,
    is_loader_required: payData.is_loader_required ?? 0,
    loaders_amount: payData.loaders_amount ?? 0,
    loaders_count: payData.loaders_count ?? 0,
    delivery_instruction: payData.delivery_instruction ?? "",
    vehicle_id: order.vehicleId,
    delivery_images: payData.delivery_images ?? "",
    surge_cost: surgeCost,
    surge_type: surgeType,
    sareaId,
    unique_order_id: order.orderId,
  });

  if (create.status !== 200) {
    throw new Error(`KWIK create_task_via_vendor failed: ${JSON.stringify(create)}`);
  }

  const createData = asRecord(create.data);
  const pickupJobs = asRecordArray(createData.pickups);
  const deliveryJobs = asRecordArray(createData.deliveries);
  const taskOtps = asRecordArray(createData.task_otp);

  const pickupJobId = pickupJobs[0]?.job_id ?? null;
  const deliveryJobId = deliveryJobs[0]?.job_id ?? null;
  const taskId = deliveryJobId ?? pickupJobId;

  const trackingUrl =
    deliveryJobs[0]?.result_tracking_link ?? pickupJobs[0]?.result_tracking_link ?? null;

  if (!taskId) throw new Error(`Missing job_id: ${JSON.stringify(create)}`);

  return {
    taskId: String(taskId),
    trackingUrl: toStringOrNull(trackingUrl),
    raw: create,
    perTaskCost,
    otp: taskOtps[0]?.job_otp ?? null,
    uniqueOrderId: toStringOrNull(createData.unique_order_id),
    statusCheckUrl: toStringOrNull(createData.job_status_check_link),
  };
}
