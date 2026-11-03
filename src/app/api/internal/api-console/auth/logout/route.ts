import {
  createAdminLogoutResponse,
} from "@/lib/auth/adminSession";

export async function POST() {
  return createAdminLogoutResponse();
}
