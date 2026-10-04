export function AccessDenied({ what }: { what: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Not available</h1>
      <p className="text-sm text-zinc-500">
        Your role doesn&apos;t give access to {what}. Ask an Admin if you think this is wrong.
      </p>
    </div>
  );
}
