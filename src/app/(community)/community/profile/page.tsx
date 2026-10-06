import Link from "next/link";
import { Card, PageHeader, buttonClass } from "@/components/ui";
import { appUrl } from "@/modules/accounts";
import { requireMember } from "@/lib/session";
import { ensureProfile } from "@/modules/community";
import { ChangePasswordForm } from "../../../(authenticated)/account/change-password-form";
import { ProfileForm } from "../forms";

export default async function MyProfilePage() {
  const { member, current } = await requireMember();
  const p = await ensureProfile(member);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Community"
        title="My profile"
        description="How other members find you. Fill in what you build, your city and your tools."
        actions={
          <Link href={`/members/${p.handle}`} className={buttonClass("secondary", "sm")}>
            View my profile
          </Link>
        }
      />
      <Card>
        <ProfileForm
          baseUrl={appUrl()}
          defaults={{
            handle: p.handle,
            headline: p.headline,
            bio: p.bio,
            city: p.city,
            tools: p.tools,
            websiteUrl: p.websiteUrl,
            githubUrl: p.githubUrl,
            linkedinUrl: p.linkedinUrl,
            xUrl: p.xUrl,
            reviewer: p.reviewer,
            wantsMentor: p.wantsMentor,
            visibility: p.visibility,
          }}
        />
      </Card>
      {current ? (
        <p className="text-sm text-muted">
          Email, password and Google Calendar settings are on your{" "}
          <Link href="/account" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Account page
          </Link>
          .
        </p>
      ) : (
        <Card title="Change password" description={`Signed in as ${member.email}. Changing it signs you out on your other devices.`}>
          <ChangePasswordForm />
        </Card>
      )}
    </div>
  );
}
