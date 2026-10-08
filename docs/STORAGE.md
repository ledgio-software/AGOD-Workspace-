# File storage (Phase 26.1)

Pictures and files are kept in **file storage** (object storage), never in the database. The database
only keeps a small record for each file: where it is stored, its type, its size and (for showcase
screenshots) its fingerprint.

## How we keep storage small and cheap

| What | How | Effect |
|---|---|---|
| **Pictures are made smaller in the browser** before upload | Largest side at most 1600 pixels, saved as WebP (JPEG on browsers without WebP). GIFs are kept as they are. | A 3 to 7 MB phone screenshot usually becomes 100 to 300 KB: less storage, less mobile data for members, faster pages. Hidden photo details (like GPS location) are removed. |
| **Each screenshot gets a fingerprint** (SHA-256) | The same picture is stored once, however many projects use it, and can't be added twice to one project. | No duplicates. |
| **Video demos are links** | Members upload to YouTube (unlisted), Loom or Google Drive and paste the link. | Those services store and compress video for free. |
| **Article covers** (Phase 37) | One optional cover per article, shrunk in the browser like screenshots. | About the same as one screenshot per article. |
| **Limits** | 4 MB per file after shrinking, four screenshots per project, five projects a day. | Predictable growth. |

Roughly: at about 250 KB per screenshot, **10 GB holds about 40,000 screenshots**.

## Where files are stored

The app picks, in this order:

1. **S3-compatible storage** (Cloudflare R2 recommended, or Backblaze B2): used when all four `S3_*`
   settings are present.
2. **Vercel Blob**: used when `BLOB_READ_WRITE_TOKEN` is set (what staging uses since Phase 9).
3. A folder on disk: local development and tests only (never on Vercel).

Switching is a setting, not a code change. Files saved before the switch stay readable from where they
were saved (new keys are marked `s3:`), as long as the old settings (`BLOB_READ_WRITE_TOKEN`) stay set.
Nothing is copied automatically.

## Setting up Cloudflare R2 (recommended when you grow)

R2 has a free monthly allowance (around 10 GB of storage when last checked) and **no charge for
downloads**, which matters when many people view screenshots. Check Cloudflare's pricing page for
current numbers.

1. Create a free Cloudflare account at <https://dash.cloudflare.com> and open **R2 Object Storage**
   (it may ask for a card even on the free allowance).
2. **Create bucket**, e.g. `gvcd-files` (one for staging and another for production, e.g.
   `gvcd-files-staging`). Keep it **private** (no public access): the app serves files itself and
   checks who may see them.
3. **Manage R2 API Tokens → Create API token**: permission *Object Read & Write*, limited to that bucket.
   Copy the **Access Key ID**, the **Secret Access Key** and the **S3 endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`).
4. In Vercel (**Project → Settings → Environment Variables**, per environment) add:

   | Variable | Value | Sensitive |
   |---|---|---|
   | `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | no |
   | `S3_BUCKET` | `gvcd-files-staging` | no |
   | `S3_ACCESS_KEY_ID` | the access key id | yes |
   | `S3_SECRET_ACCESS_KEY` | the secret access key | yes |

5. Redeploy. New uploads go to R2; keep `BLOB_READ_WRITE_TOKEN` so older files still open.

Backblaze B2 works the same way (its S3 endpoint looks like `https://s3.<region>.backblazeb2.com`; set
`S3_REGION` to the region).

## Later

- Short video uploads (e.g. up to 60 seconds) through a video service such as Cloudflare Stream, when
  there is a budget.
- Moving old Blob files to R2 with a one-off script, to drop Blob entirely.
