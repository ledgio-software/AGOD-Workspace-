import { Card, PageHeader } from "@/components/ui";
import { getSignedIn } from "@/lib/session";
import { platformLog } from "@/modules/platform";
import { AuditList } from "../audit-list";

export const metadata = { title: "Log" };

// Phase 40: every back-office action, newest first, with who did it and why.

export default async function ConsoleLog() {
  const me = (await getSignedIn())!;
  const rows = await platformLog(me);
  return (
    <>
      <PageHeader title="Back-office log" description="Every suspension, block, password link and organizer change made here, with the reason given. It can't be edited." />
      <Card title={`Latest ${rows.length}`}>
        <AuditList rows={rows} showTarget empty="Nothing yet." />
      </Card>
    </>
  );
}
