import { redirect } from "next/navigation";

// Phase 25: people without a company are community members; the community home replaces the old
// "not in a company" page (and offers to create a company).
export default function NoCompanyPage() {
  redirect("/community");
}
