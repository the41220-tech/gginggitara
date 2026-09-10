import { redirect } from "next/navigation";
import { AdminAuthorizationError, requireAdminUser } from "@/lib/admin-auth";
import AdminDashboardClient from "./AdminDashboardClient";

export default async function AdminDashboardPage() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      redirect("/admin");
    }
    throw error;
  }

  return <AdminDashboardClient />;
}
