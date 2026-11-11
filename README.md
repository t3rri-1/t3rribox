# t3rribox

Free file hosting with short links, running on Vercel and storing files in a GitHub repo.

Drop a file on the page and get a link like `https://t3rribox.vercel.app/839201.jpg`: a random 6-digit number plus the original extension. GitHub URLs are never shown to visitors. Upload the same file twice and you get the same link back.

## How it works

- `POST /api/upload` accepts a file, hashes it (SHA-256) and looks the hash up in `_index.json` in the storage repo.
- A known hash returns the existing link with `"duplicate": true`. A new file gets a free 6-digit ID, is committed to `files/` through the GitHub Contents API, and is added to the index.
- `/{6 digits}.{ext}` is rewritten to `api/file.js`, which streams the file from GitHub's raw URL, fixes the `Content-Type` from the extension (GitHub sends everything as `text/plain`), and sets a one-year cache so Vercel's edge serves repeat views.
- Code is ESM with native `fetch`. Nothing is written to disk. There are no dependencies.

## Setup

### 1. Storage repo

Create a GitHub repo for the files, for example `t3rribox`. Tick **Add a README** so the repo is not empty. It can be private.

**Keep it separate from this project's code repo.** If Vercel watches the same repo that stores the files, every upload commit triggers a new deployment.

### 2. Token

GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token.

- Repository access: **Only select repositories** → the storage repo
- Permissions → Repository → **Contents: Read and write**

### 3. Deploy to Vercel

Push this project to its own GitHub repo (for example `t3rribox-site`), then Vercel → Add New → Project → import it. Leave the framework as **Other** and the build command empty. Add the environment variables below, then deploy.

## Environment variables

| Name | Required | What it does |
| --- | --- | --- |
| `GITHUB_TOKEN` | yes | The fine-grained token from step 2. |
| `GITHUB_REPO` | yes | The storage repo as `owner/repo`. |
| `GITHUB_BRANCH` | no | Branch to commit to. Default `main`. |
| `SITE_URL` | recommended | Your public address with no trailing slash, e.g. `https://t3rribox.vercel.app`. Used in links, canonical tags and the sitemap. |
| `GOOGLE_SITE_VERIFICATION` | no | Search Console "HTML tag" token. See below. |
| `GOOGLE_VERIFICATION_FILE` | no | Search Console "HTML file" name. See below. |
| `INDEX_FILES` | no | `true` lists uploads in the sitemap and lets Google index them. Default `false`. |
| `MAX_UPLOAD_MB` | no | Size limit. Default `20`. |
| `EXTRA_BLOCKED_EXTENSIONS` | no | More blocked extensions, comma separated, e.g. `msi,dll`. |
| `GITHUB_RAW_VIA_API` | no | `true` reads files through the GitHub API instead of `raw.githubusercontent.com`. Try it if a private repo's files do not load. |

Changing a variable needs a redeploy to take effect.

## Google Search Console

1. Open [Search Console](https://search.google.com/search-console), choose **Add property**, then **URL prefix**, and enter your `SITE_URL` with a trailing slash. (`vercel.app` addresses cannot use the DNS method.)
2. Verify with **one** of these:
   - **HTML tag:** copy only the `content="..."` value into `GOOGLE_SITE_VERIFICATION`. Pasting the whole `<meta>` tag also works. Redeploy, then press Verify.
   - **HTML file:** put the file name Google gives you (like `google1a2b3c4d5e6f7a8b.html`) into `GOOGLE_VERIFICATION_FILE`. Redeploy, then press Verify. Dropping the downloaded file into `public/` works too.
3. In Search Console open **Sitemaps** and submit `sitemap.xml`.

Leave the verification in place afterwards, because Google re-checks it from time to time. Several values can be comma separated if you verify more than one property.

## Sitemap and indexing

- `/sitemap.xml` lists the home page and `/docs`. `/robots.txt` points to it and keeps crawlers out of `/api/`.
- Uploaded files are sent with `X-Robots-Tag: noindex`, so random uploads do not end up in search results.
- With `INDEX_FILES=true`, uploads are added to the sitemap (up to 50,000, images get image entries) and the `noindex` header is dropped. Public user uploads can attract spam and abuse reports, so turn this on only if you want that.

## API

Open `/docs` on your site for the full reference. In short:

| Request | Purpose |
| --- | --- |
| `POST /api/upload` | Upload with multipart (`file` field), raw bytes (`X-Filename` header) or JSON (`filename` + `base64`). |
| `POST /api/upload?chunk=1`, then `?complete=1` | Upload in parts, for files over about 4 MB. |
| `GET /api/info?id=839201` or `?sha256=...` | Look up a file, or check whether it is already hosted. |
| `GET /api/health` | Returns `{ "ok": true }`. |

```bash
curl -F "file=@photo.jpg" https://t3rribox.vercel.app/api/upload
```

CORS is open, so browsers on other sites can call it.

## Limits and good to know

- **Vercel caps request bodies at 4.5 MB.** The page and the API therefore send files over about 4 MB in parts of 4 MB. Each part is stored as an unreferenced Git blob, then `?complete=1` stitches them together. The 20 MB limit still holds, but it needs the Git Data API, which does not work on an empty repo.
- Blocked extensions: `.exe .scr .cpl .jar .bat .cmd .sh .doc .docm`. HTML, SVG and XML files are served with a sandboxed Content-Security-Policy so they cannot run scripts.
- Links are unlisted, not private. A 6-digit ID can be guessed, so do not upload anything secret.
- GitHub's terms discourage using repositories as a heavy file host, and repos have size limits (a few GB). Watch the storage repo and move to object storage if this grows.
- To remove a file, delete it from `files/` and delete its line from `_index.json` in the storage repo. The edge may keep serving it until you purge the CDN cache in your Vercel project settings.
- There is no upload rate limit beyond GitHub's own. A burst of uploads shows a friendly "try again in a minute" message.

## Troubleshooting

| You see | Fix |
| --- | --- |
| "The storage repo is empty" | Add a README to the storage repo. |
| "The GitHub token is invalid or expired" | Create a new token and update `GITHUB_TOKEN`. |
| "Storage access was denied" | The token needs **Contents: Read and write** on the storage repo. |
| "The storage repo or branch wasn't found" | Check `GITHUB_REPO` (`owner/repo`) and `GITHUB_BRANCH`. |
| Files upload but do not open (private repo) | Set `GITHUB_RAW_VIA_API=true` and redeploy. |

## Project layout

```
api/
  upload.js   upload endpoint (multipart, raw, base64, chunks)
  file.js     serves /{6 digits}.{ext} from GitHub
  info.js     file lookup
  health.js   { ok: true }
  page.js     renders the home and docs pages
  seo.js      sitemap.xml, robots.txt, Search Console verification file
lib/          GitHub client, storage logic, multipart parser, MIME types
views/        home.html and docs.html templates
public/       style.css, favicon, 404 page
vercel.json   rewrites and function settings
```
