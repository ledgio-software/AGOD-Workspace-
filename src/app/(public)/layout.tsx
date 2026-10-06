import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { getSignedIn } from "@/lib/session";
import { signupOpen } from "@/modules/accounts";
import { chatLinks } from "@/modules/community";

// Phase 25: the community's public pages (home, members, profiles, code of conduct), open to
// visitors. Signed-in people get a link back into the app.

const initials = PRODUCT_NAME.split(/\s+/)
  .filter((w) => /^[A-Za-z]/.test(w))
  .slice(0, 2)
  .map((w) => w[0])
  .join("");

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await getSignedIn();
  const chat = chatLinks();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white shadow-sm">{initials}</span>
            <span className="hidden truncate text-sm font-semibold sm:block">{PRODUCT_NAME}</span>
          </Link>
          <nav aria-label="Community" className="ml-2 flex items-center gap-1 text-sm">
            <Link href="/showcase" className="rounded-lg px-2 py-1.5 text-muted hover:bg-surface-muted hover:text-fg">
              Showcase
            </Link>
            <Link href="/members" className="rounded-lg px-2 py-1.5 text-muted hover:bg-surface-muted hover:text-fg">
              Members
            </Link>
            <Link href="/code-of-conduct" className="hidden rounded-lg px-2 py-1.5 text-muted hover:bg-surface-muted hover:text-fg sm:block">
              Code of conduct
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {signedIn ? (
              <Link href="/community" className={buttonClass("primary", "sm")}>
                Open the app
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className={buttonClass("secondary", "sm")}>
                  Sign in
                </Link>
                {signupOpen() && (
                  <Link href="/sign-up" className={buttonClass("primary", "sm")}>
                    Join
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-12">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
          <span>{PRODUCT_NAME}: built in Ghana, for Ghana&apos;s builders.</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto">
            <Link href="/code-of-conduct" className="hover:text-fg">
              Code of conduct
            </Link>
            {chat.discord && (
              <a href={chat.discord} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                Discord
              </a>
            )}
            {chat.whatsapp && (
              <a href={chat.whatsapp} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                WhatsApp
              </a>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}
