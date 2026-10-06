# Community (Phase 25)

The website is now two things in one place:

1. **The community** (new, for everyone): people in Ghana who build software, by hand or with AI
   tools, join for free, make a profile, find reviewers and mentors, and (in the next phases) share
   projects, ask for reviews and join teaching sessions. It follows the *Ghana Vibe Coders &
   Developers Community Handbook*.
2. **Company workspaces** (what existed before, private): projects, tasks, invoices and team
   payouts for a company or team (`docs/COMPANIES.md`). Members create one when they need it.

## Pages

| Page | Who | What |
|---|---|---|
| `/` | everyone | The front door: what the community is, who it is for, new members, *Join*. |
| `/members` | everyone | Member list with search (name, what they build, tools), city and "reviewers only". Visitors see public profiles; signed-in members see members-only ones too. |
| `/members/<address>` | everyone (see below) | A profile: what they build, city, tools, about, links, badges (Organizer, Reviewer, Looking for a mentor). Never the email. Signed-in members can report it. |
| `/code-of-conduct` | everyone | The community rules and how to give good feedback. |
| `/showcase` | everyone | Projects members share (Phase 26), newest first; tabs *Needs review* (fewest reviews first) and *Shipped*; search by name, pitch or tool. |
| `/showcase/<id>` | everyone (see below) | A project: screenshots, *Try it*, *Watch the demo*, code link, what they want feedback on, and the feedback. Signed-in members give feedback, report, and (the author) reply, edit, mark shipped, add screenshots or take it down. |
| `/community/showcase/new` | signed in | *Share a project*: the handbook template with a live preview card. |
| `/community` | signed in | Community home: getting-started checklist, chat links, new members, and the company workspace card (open yours, or create one). |
| `/community/profile` | signed in | Edit your profile (and, without a company, change your password). |
| `/community/reports` | organizers | Reported profiles: hide (with a note) or dismiss. |

Everyone signed in gets a **Community** section in the sidebar; people in a company also keep their
company's sections. People without a company see only the community (company pages send them there).

## Joining

- **Sign-up** (`ALLOW_SIGNUP=true` and email set up): name, email, password, and agreeing to the code of
  conduct. *Also create a company workspace* is optional (tick it and name the company). After the
  confirmation email the person lands on the community home (or their new company's dashboard).
- Their profile starts **public** with the code of conduct recorded. They then fill in what they build,
  their city and tools.
- People added to a company by an Admin are community members too. Their profile is created the first
  time they open the community, visible to **signed-in members only** until they choose *Everyone*.
- A member without a company can create a workspace from the community home at any time (while
  sign-up is open). Free while we test.

## Roles

| Role | How | Can |
|---|---|---|
| Builder | everyone | Profile, member list, report profiles. |
| Reviewer | tick *I can review work and mentor* on your profile | Reviewer badge; listed under "Reviewers only". (Review requests come in the showcase phase.) |
| Organizer | `COMMUNITY_ORGANIZER_EMAILS`, or made by another organizer on a profile page | Reports page; hide and show profiles; make or remove organizers. Can't remove their own role or handle a report about themselves. |

Community roles are separate from company roles (Admin, Project Manager, Team Member).

## Showcase and reviews (Phase 26)

- **Sharing** (after agreeing to the code of conduct): project name, what it does in one sentence, who it
  is for, what it is built with, whether AI wrote most of it, live demo, repository, a **video demo link**
  (Loom, YouTube, Google Drive...; linked, not embedded, to save data), what reviewers should look at
  (design, code, security, idea, user experience), what you want feedback on, what you are stuck on, and
  what you need (testers, feedback, users, collaborators). The card preview updates as you type.
- **Safety check**: before posting (and after every edit) the author confirms there are no secrets in the
  links, repository or screenshots, private pages need a login, and no real personal data is shown.
- **Screenshots**: PNG, JPG, WebP or GIF up to 4 MB, at most four, stored in the app's file storage
  (Vercel Blob) and served through the app (the first is the card image). Without file storage the
  screenshot fields are hidden.
- **Visibility**: everyone, or signed-in members only (screenshots follow the project).
- **Status**: *Needs review* (new), *Reviewed* (after the first feedback), *Shipped* (the author marks
  it; *Ask for more feedback* returns it to the queue).
- **Feedback** follows the handbook: what works, one or two things to improve, one next step. One per
  person and project, never on your own; the author is emailed and may reply once to each.
- **Give back**: profiles and the share page show projects shared and reviews given; the community home
  lists projects waiting for feedback (fewest reviews first, not yours or ones you reviewed).
- **Limits**: five projects a day per member.

## Moderation

Members can report profiles, projects and feedback. A member reports something with a reason (once per profile while it is open). Organizers see who
reported it and why. **Hide it** makes it invisible to everyone but its owner and the
organizers (who see the reason) and closes every open report about it; **dismiss** closes them without
changes. Hidden things can be shown again from their page. Authors can take down their own projects. Deactivated logins disappear from the
community.

## Setup (Vercel, per environment)

| Variable | Value |
|---|---|
| `ALLOW_SIGNUP` | `true` to let people join (needs email). |
| `COMMUNITY_ORGANIZER_EMAILS` | Your email (comma-separate several): the first organizers. |
| `COMMUNITY_DISCORD_URL`, `COMMUNITY_WHATSAPP_URL` | Optional invite links shown on the community home and footer. |

Redeploy after changing them.

## For developers

- Tables `member_profiles`, `community_reports`, `showcase_posts`, `showcase_images` and
  `showcase_reviews` are shared by the whole platform (no
  `organization_id`). The app role has no access; `src/modules/community` reads and writes them
  through the owner connection after its own checks (like the Google tables).
- Public pages are listed in `src/proxy.ts`; they read the session when there is one
  (`getSignedIn`), and community pages use `requireMember()` (signed in, company optional).

## Next

Teaching sessions with Google Meet (Phase 27), mentorship
matching, the tools and prompts library and project of the month (Phase 28).
