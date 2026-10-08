import Link from "next/link";
import { ImageOff } from "lucide-react";
import { Callout, Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { canModerate } from "@/modules/community";
import { MAX_FRONT_PHOTOS, frontPage, photosAvailable } from "@/modules/community/front";
import { FrontHero } from "../../../(public)/front-hero";
import { ButtonForm } from "../growth-forms";
import { addPhotoAction, removePhotoAction, videoAction } from "./actions";
import { PhotoForm, VideoForm } from "./forms";

// Phase 35: organizers choose the front page photos (a slideshow behind the welcome text) and the
// welcome video beside it. Shown on the public home page and the community home.

export default async function FrontPageSettings() {
  const { member } = await requireMember();
  if (!(await canModerate(member))) {
    return (
      <Callout tone="info">
        Only community organizers can change the front page. <Link href="/community" className="font-medium underline">Back to the community</Link>
      </Callout>
    );
  }
  const front = await frontPage();
  const uploads = photosAvailable();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Community" title="Front page photos and video" description="What visitors and members see first: photos of the community behind the welcome text, and a welcome video beside it." />

      <FrontHero front={front}>
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">Preview</p>
        <h2 className="text-2xl font-semibold sm:text-4xl">Ghana Vibe Coders</h2>
        <p className="max-w-xl text-white/90">This is how the top of the home page looks with these photos and this video.</p>
      </FrontHero>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Background photos" description={`Up to ${MAX_FRONT_PHOTOS}. They fade from one to the next every few seconds.`}>
          <div className="space-y-5">
            {front.photos.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {front.photos.map((p) => (
                  <li key={p.id} className="space-y-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/front/photos/${p.id}`} alt={p.alt} className="aspect-video w-full rounded-lg object-cover" />
                    <p className="truncate text-xs text-muted" title={p.alt}>
                      {p.alt}
                    </p>
                    <ButtonForm action={removePhotoAction.bind(null, p.id)} label="Remove" confirmMessage="Remove this photo from the front page?" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No photos yet: the banner uses the brand colours.</p>
            )}
            {!uploads ? (
              <Callout tone="warn" icon={ImageOff}>
                Photo uploads aren&apos;t switched on yet. An admin needs to connect file storage (Vercel → Storage → Blob, see docs/SETUP.md), then redeploy.
              </Callout>
            ) : front.photos.length < MAX_FRONT_PHOTOS ? (
              <PhotoForm action={addPhotoAction} />
            ) : (
              <p className="text-sm text-muted">Remove a photo to add another.</p>
            )}
          </div>
        </Card>

        <Card title="Welcome video" description="It loads only when someone taps play, to save data.">
          <VideoForm action={videoAction} defaults={{ url: front.video?.url ?? "", title: front.video?.title ?? "" }} />
        </Card>
      </div>
    </div>
  );
}
