import {
  handleAdminLogin,
} from "@/lib/auth/adminSession";

export const runtime = "nodejs";

export async function POST(
  req: Request
) {
  return handleAdminLogin(req);
}
