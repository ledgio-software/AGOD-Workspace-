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
| `/sessions` | everyone | Teaching sessions (Phase 27): upcoming (soonest first) and *Past sessions & recordings*. |
| `/sessions/<id>` | everyone (call link: see below) | A session: time (Accra), length, level, topics, host, who's coming (signed in), *Join*, *Add to calendar*, recording and notes. |
| `/community/sessions/new` | Reviewers and organizers | *Host a session*, with the handbook's session ideas. |
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
- **Screenshots**: PNG, JPG, WebP or GIF, at most four, made smaller in the browser before upload (Phase
  26.1, `docs/STORAGE.md`), fingerprinted so identical pictures are stored once, kept in the app's file
  storage (Vercel Blob or Cloudflare R2) and served through the app (the first is the card image). Without file storage the
  screenshot fields are hidden.
- **Visibility**: everyone, or signed-in members only (screenshots follow the project).
- **Status**: *Needs review* (new), *Reviewed* (after the first feedback), *Shipped* (the author marks
  it; *Ask for more feedback* returns it to the queue).
- **Feedback** follows the handbook: what works, one or two things to improve, one next step. One per
  person and project, never on your own; the author is emailed and may reply once to each.
- **Give back**: profiles and the share page show projects shared and reviews given; the community home
  lists projects waiting for feedback (fewest reviews first, not yours or ones you reviewed).
- **Limits**: five projects a day per member.

## Teaching sessions (Phase 27)

- **Hosting**: members who agreed to the code of conduct and have the **Reviewer** badge (tick *I can
  review work and mentor* on their profile), and organizers. A session has a title, what people will
  learn, level (beginners, some experience, everyone), topics, date and start time (Accra), length
  (15 minutes to 6 hours), optional seats and the **call link** (Google Meet, Zoom or a Discord
  voice/stage channel: the call itself runs there). At most five upcoming sessions per host.
- **The call link is private**: only the host, people who joined and organizers see it (on the page, in
  emails and in the calendar file). Visitors see everything else and are asked to sign in.
- **Joining** takes a seat (sessions with seats show *Full* when taken) and emails a confirmation with
  the link and an **.ics calendar file** (Google Calendar, Outlook, Apple Calendar). *Add to calendar*
  downloads the same file. *Leave* gives the seat back.
- **Reminders**: the daily job (06:00 Accra) emails everyone who joined a session starting within the next
  24 hours, once.
- **Changes**: if the host changes the time or link, people who joined get an email with the new details
  and calendar file (and a fresh reminder). Cancelling (host or organizer) emails everyone with a
  calendar cancellation.
- **Afterwards** the host adds the recording link (YouTube unlisted, Loom, Drive) and key notes; past
  sessions form the recordings archive.

## Moderation

Members can report profiles, projects, feedback and sessions. A member reports something with a reason (once per profile while it is open). Organizers see who
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

- Tables `member_profiles`, `community_reports`, `showcase_posts`, `showcase_images`,
  `showcase_reviews`, `community_sessions` and `community_session_attendees` are shared by the whole platform (no
  `organization_id`). The app role has no access; `src/modules/community` reads and writes them
  through the owner connection after its own checks (like the Google tables).
- Public pages are listed in `src/proxy.ts`; they read the session when there is one
  (`getSignedIn`), and community pages use `requireMember()` (signed in, company optional).

## Mentors, tools & prompts, project of the month (Phase 31)

| Page | Who | What |
|---|---|---|
| `/mentors` | everyone | Reviewers open to mentoring, best match first for a signed-in member (shared tools score two, the same city one; mentors with space first). Members ask with a goal. |
| `/community/mentoring` | members | Offer to mentor (Reviewers: on/off, 1 to 5 people, what you help with); answer requests; your mentors and mentees. Once a mentor accepts, both see each other's email to agree how to meet. A member asks at most 2 mentors at a time; either side can end it. Emails on a new request and on the answer. |
| `/library`, `/library/<id>` | everyone | Tools (link), prompts (text with a Copy button) and guides (link) shared by members, with tags, "works on slow internet" and "free". Members mark items useful (not their own); featured and most useful first. Organizers feature items and hide reported ones. |
| `/community/library/new` | members (after the code of conduct) | Share an item; 10 a day. The author edits or removes it. |
| `/showcase` | everyone | Last month's project of the month and this month's leaders. |
| `/showcase/<id>` | members | One vote a month for a project that isn't yours (vote again to take it back, or vote for another to move it). Organizers can pick last month's project themselves, with a note. |

When a month ends, the daily job (and the first page that shows it) settles it: the project with
the most votes becomes project of the month; on a tie, the one that got there first. Months are in
Accra time. Winners get a "Project of the month" badge on their project.

## Jobs & gigs and the team finder (Phase 33)

| Page | Who | What |
|---|---|---|
| `/jobs`, `/jobs/<id>` | everyone | Open jobs, gigs and internships, newest first, filtered by type, remote/on site/hybrid, skill and words. A warning that nobody may ask applicants for money. Members apply with a short message and an optional link. |
| `/community/jobs` | members | Jobs I posted with everyone who applied (their message, link, profile and email), to shortlist, hire or decline; mark a job filled or close it. Jobs I applied for, with the poster's email once I'm shortlisted or hired; withdraw. |
| `/community/jobs/new`, `/community/jobs/<id>/edit` | members (after the code of conduct) | Post or edit a job. |
| `/teams`, `/teams/<id>` | everyone | Ideas that need people ("Looking for teammates": roles needed) and people looking for a team ("Looking for a team": roles they can take), with tools, time needed and the reward. Members ask to join, or invite. |
| `/community/teams`, `/community/teams/new`, `/community/teams/<id>/edit` | members | My posts with the requests they got (accept or decline, with a note), and the requests I sent (withdraw). |

Rules:

- **Pay is always shown** for jobs and gigs (from, optional "up to", for the work / a month / an
  hour, in GHS); internships may leave it out. Posts asking applicants for a registration, training
  or application fee are refused, and members can report any job.
- A job stays open for at most 60 days, then leaves the board by itself. 5 new jobs a day and 10
  open at a time per member; 20 applications a day.
- **Contact details:** applying shares your name, email and profile with the poster; the poster's
  email is shared with you when they shortlist or hire you. On the team finder, both emails are
  shared only when a request is accepted. Everyone gets an email for a new application or request
  and for the answer.
- Team finder: 3 open posts per member, 10 requests a day; a declined request can't be sent again
  to the same post.
- Organizers hide reported jobs and posts from the Reports page, as for everything else.

## Front page photos and video (Phase 35)

| Page | Who | What |
|---|---|---|
| `/` and `/community` | everyone / members | The welcome banner: the organizers' photos fade one into the next behind the welcome text (a brand colour wash when there are none), with the welcome video beside it (below it on a phone). The video loads only when someone taps play, to save data. |
| `/community/front-page` | organizers | Add up to 6 photos (made smaller in the browser before upload; each needs a short description for screen readers), remove them, and set or remove the welcome video (a YouTube, Vimeo, Loom or Google Drive link). Shows a live preview. |
| `/front/photos/<id>` | everyone | The photos themselves (public, cached for a day). |

Project videos: on a showcase project, a YouTube, Vimeo, Loom or Google Drive link now plays on the
project page (other links still open in a new tab). The share form has a clear "Pictures and video"
section, and says so plainly when picture uploads aren't switched on (no file storage connected)
instead of hiding the field.

Photos and pictures need file storage (Vercel Blob or S3/R2, `docs/STORAGE.md`); videos don't (they
stay on YouTube, Vimeo, Loom or Google Drive, which keeps hosting free and adapts to slow internet).

## Chat and feedback conversations (Phase 36)

| Page | Who | What |
|---|---|---|
| `/community/chat/<channel>` | members (posting after the code of conduct) | Channels like Discord: #general, #help, #ai-tools, #show-and-tell, #jobs-and-gigs and #off-topic. New messages appear within a few seconds without reloading. Reply in a thread, react with an emoji, tag people with @handle (they see an @ badge on the channel and the message highlighted), delete your own messages, report others'. In #help each message is a question: answer it in its thread, and the asker (or an organizer) marks it solved. |
| `/showcase/<id>` | the project's author and the reviewer | Under each piece of feedback, the author and the reviewer reply to each other as often as they need; each reply emails the other one. |

Keeping data use low: an open chat asks every 4 seconds "has anything changed?" and gets a tiny
"no" unless something did; only then does it download the new messages. It stops asking while the
tab is in the background. Members can send 20 messages a minute at most.

Organizers hide messages straight away (or from the Reports page); hidden and deleted messages
show as "hidden" or "deleted" so threads still make sense. The Discord and WhatsApp links
(`docs/COMMUNITY.md`, Phase 25) stay for people who prefer them.

## Articles (Phase 37)

| Page | Who | What |
|---|---|---|
| `/articles` | everyone, no account needed | The feed: Latest (new articles and reposts, newest first; each article once), Most useful (useful marks in the last 30 days) and Reviewed. Filter by tag, search by words. |
| `/articles/<id>` | everyone reads; members take part | The article (headings, lists, quotes, code, https links), cover picture, reading time. Members mark it useful, save it for later, comment and reply, repost it with a note, and report it. Members with the Reviewer badge mark it reviewed with a short note. |
| `/community/articles` | members | My drafts and published articles, and my reading list. |
| `/community/articles/new`, `/community/articles/<id>/edit` | the author (after the code of conduct) | Write with a Write/Preview switch, tags (up to 5), a cover picture (when picture uploads are on, `docs/STORAGE.md`); save a draft or publish; take it back to draft or delete it. |
| `/members/<handle>` | everyone | A member's articles and reposts. |

The author gets an email for each comment, review and repost; a commenter gets one when someone
replies to them. Articles are written in a small Markdown that is turned into page elements (never
raw HTML), and only https links (or links on this site) become links, so nothing in an article can
run code in a reader's browser. Limits: 5 new articles a day, 30 comments an hour. Organizers hide
articles and comments from the Reports page; a hidden article can't be published again until they
show it.

Learning from other members' work: articles, showcase project pages (screenshots, the video demo
playing on the page, the live link and the feedback conversations), session recordings and the tools
& prompts library are all public, so visitors learn without an account.

## Next

Badges, events calendar, partners page and community numbers.
