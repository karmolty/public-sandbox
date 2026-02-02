import { DateTime } from "luxon";
import fs from "node:fs";
import path from "node:path";

const TZ = "America/Los_Angeles";
const SITE_DIR = path.resolve("site");
const ASSETS_DIR = path.join(SITE_DIR, "assets");
const MEME_PATH = path.join(ASSETS_DIR, "daily-meme.jpg");

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickN(arr, n, rand) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(rand() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      // Reddit blocks generic UAs; keep it clear & polite.
      "user-agent": "TheDailyMewsBot/1.0 (GitHub Actions)"
    }
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return res.json();
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "TheDailyMewsBot/1.0 (GitHub Actions)"
    }
  });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function isLikelyImageUrl(u) {
  return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(u);
}

function decodeXmlEntities(s) {
  return String(s)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function findDailyMeme() {
  // Reddit’s JSON endpoints often 403 from CI/servers; Atom RSS is more reliable.
  const rssUrl = "https://www.reddit.com/r/Catmemes/top/.rss?t=day";
  const res = await fetch(rssUrl, {
    headers: { "user-agent": "TheDailyMewsBot/1.0 (GitHub Actions)" }
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${rssUrl}`);
  const xml = await res.text();

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (entryMatch) {
    const entry = entryMatch[1];
    const title = decodeXmlEntities((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "A Very Serious Cat Development").trim();
    const permalink = decodeXmlEntities((entry.match(/<link\s+href="([^"]+)"\s*\/>/) || [])[1] || "https://www.reddit.com/r/Catmemes/");

    // Prefer media:thumbnail; otherwise look for an <img src="..."> in the HTML content.
    const thumb = decodeXmlEntities((entry.match(/<media:thumbnail\s+url="([^"]+)"\s*\/>/) || [])[1] || "");
    const contentImg = decodeXmlEntities((entry.match(/<content[^>]*>.*?<img\s+src=&quot;([^&]*)&quot;/) || [])[1] || "");

    const candidates = [thumb, contentImg].filter(Boolean).map((u) => u.replaceAll("&amp;", "&"));
    const imageUrl = candidates.find((u) => isLikelyImageUrl(u)) || candidates[0];

    if (imageUrl) {
      return { title, permalink, imageUrl };
    }
  }

  // Last resort: a stable, always-on cat image.
  return {
    title: "Breaking: Cat Seen Being A Cat",
    permalink: "https://www.reddit.com/r/Catmemes/",
    imageUrl: "https://cataas.com/cat"
  };
}

async function getCatmemesRssEntries() {
  const rssUrl = "https://www.reddit.com/r/Catmemes/top/.rss?t=day";
  const res = await fetch(rssUrl, {
    headers: { "user-agent": "TheDailyMewsBot/1.0 (GitHub Actions)" }
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${rssUrl}`);
  const xml = await res.text();

  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const entry = m[1];
    const title = decodeXmlEntities((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
    const permalink = decodeXmlEntities((entry.match(/<link\s+href="([^"]+)"\s*\/>/) || [])[1] || "");
    const author = decodeXmlEntities(
      (
        entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/) || []
      )[1] || ""
    ).trim();

    if (title && permalink) entries.push({ title, permalink, author });
  }

  return entries;
}

function normalizeTitle(s) {
  // Keep it a little chaotic; it matches the retro vibe.
  return String(s).replace(/\s+/g, " ").trim();
}

async function buildHeadlines(dateStr, rand, memeTitle) {
  // Dynamic: based on whatever is actually trending on r/Catmemes today.
  const entries = await getCatmemesRssEntries();

  const titles = entries
    .map((e) => e.title)
    .filter(Boolean)
    .map(normalizeTitle);

  const distinct = [...new Set(titles)].filter((t) => t !== memeTitle);
  const picked = pickN(distinct.length ? distinct : titles, 6, rand);

  const t = (i, fallback) => picked[i] || memeTitle || fallback;

  const pool = [
    {
      h: `BREAKING: “${t(0, "Cat Declares Independence From Gravity")}”`,
      b: `Officials confirm this is being treated as a "meow-jor" development. (Filed: ${dateStr})`
    },
    {
      h: `Markets React To: ${t(1, "Human Opens Can; Civilization Restored")}`,
      b: "Treat futures up. Productivity down. The couch remains occupied."
    },
    {
      h: `Opinion: ${t(2, "Your Keyboard Was Always A Heated Bed")} (And You Know It)`,
      b: "Experts urge humans to stop taking it personally and start providing snacks."
    },
    {
      h: `Science Desk Investigates: ${t(3, "The Mystery Of The 0.7% Empty Bowl")}`,
      b: "The peer review process consisted of one stare, two slow blinks, and a decisive nap."
    },
    {
      h: `Exclusive: Government Announces New Standard: “${t(4, "If It Fits, It Sits")}"`,
      b: "Applies to boxes, laundry baskets, and your freshly folded clothes (especially those)."
    },
    {
      h: `Weather Alert: ${t(5, "Chance Of Zoomies After Midnight")}`,
      b: "Residents advised to secure fragile objects and prepare for hallway drag races."
    }
  ];

  return pickN(pool, 4, rand).map((x) => ({ ...x }));
}

function renderHtml({ datePretty, meme, headlines }) {

  const hlHtml = headlines
    .map(
      (x) => `
      <article class="story">
        <h3>📰 ${escapeHtml(x.h)}</h3>
        <p>${escapeHtml(x.b)}</p>
      </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Daily Mews</title>
  <meta name="description" content="A very serious news site for very serious cats." />
  <style>
    :root {
      --bg: #fff7ff;
      --ink: #140014;
      --hot: #ff00cc;
      --cool: #00d5ff;
      --paper: #ffffff;
      --border: #140014;
    }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--bg);
      font-family: "Comic Sans MS", "Comic Sans", "Trebuchet MS", system-ui, sans-serif;
    }

    .topbar {
      background: linear-gradient(90deg, var(--hot), var(--cool));
      border-bottom: 4px dashed var(--border);
      padding: 10px 14px;
      text-align: center;
      font-weight: 800;
      letter-spacing: 1px;
      text-shadow: 1px 1px 0 #fff;
    }

    .wrap { max-width: 980px; margin: 0 auto; padding: 16px; }

    .masthead {
      background: var(--paper);
      border: 4px double var(--border);
      padding: 14px;
      box-shadow: 6px 6px 0 rgba(0,0,0,.25);
    }

    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.2rem, 4vw, 3.2rem);
      color: var(--hot);
      text-shadow: 2px 2px 0 #000;
    }

    .date {
      font-family: "Courier New", Courier, monospace;
      background: #f5fffd;
      border: 2px solid var(--border);
      padding: 6px 10px;
    }

    .marquee {
      margin-top: 10px;
      border: 3px ridge var(--border);
      background: #fff;
      padding: 6px 10px;
      overflow: hidden;
      white-space: nowrap;
      font-weight: 700;
    }

    .marquee span {
      display: inline-block;
      padding-left: 100%;
      animation: scroll 18s linear infinite;
    }

    @keyframes scroll {
      0% { transform: translateX(0); }
      100% { transform: translateX(-100%); }
    }

    .grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 16px;
      align-items: start;
    }

    @media (max-width: 820px) {
      .grid { grid-template-columns: 1fr; }
    }

    .panel {
      background: var(--paper);
      border: 4px solid var(--border);
      box-shadow: 6px 6px 0 rgba(0,0,0,.25);
    }

    .panel .hd {
      padding: 10px 12px;
      background: #fff0fb;
      border-bottom: 3px dashed var(--border);
      font-weight: 900;
    }

    .panel .bd { padding: 12px; }

    .meme {
      width: 100%;
      height: auto;
      border: 3px ridge var(--border);
      background: #fff;
    }

    .tiny {
      font-size: 0.95rem;
      opacity: 0.9;
    }

    .story h3 { margin: 0 0 6px 0; }
    .story p { margin: 0 0 12px 0; }
    footer {
      margin: 18px 0 30px;
      text-align: center;
      font-family: "Courier New", Courier, monospace;
      font-size: 0.95rem;
    }

    a { color: #0000ee; }
    a:visited { color: #551a8b; }
  </style>
</head>
<body>
  <div class="topbar">WELCOME TO THE DAILY MEWS • YOUR #1 SOURCE FOR CAT FACTS, FEELINGS, & FIBS (SATIRE)</div>

  <div class="wrap">
    <div class="masthead">
      <div class="brand">
        <h1>The Daily Mews</h1>
        <div class="date">${escapeHtml(datePretty)}</div>
      </div>
      <div class="marquee"><span>BREAKING: Experts confirm your cat was right all along • UPDATE: the bowl is 0.7% empty • DEVELOPING: box acquisition at an all-time high •</span></div>
    </div>

    <div class="grid">
      <section class="panel">
        <div class="hd">🐾 Today’s Featured Cat Meme </div>
        <div class="bd">
          <img class="meme" src="assets/daily-meme.jpg" alt="Daily cat meme" />
          <p class="tiny">
            Source: <a href="${escapeHtml(meme.permalink)}" target="_blank" rel="noreferrer">r/Catmemes</a>“${escapeHtml(meme.title)}”
          </p>
        </div>
      </section>

      <aside class="panel">
        <div class="hd">🧶 Headlines</div>
        <div class="bd">
          ${hlHtml}
        </div>
      </aside>
    </div>

    <footer>
      © ${escapeHtml(String(new Date().getUTCFullYear()))} The Daily Mews • Best viewed on a beige CRT •
      <a href="https://github.com/karmolty/daily-mews" target="_blank" rel="noreferrer">source</a>
    </footer>
  </div>
</body>
</html>`;
}

async function main() {
  const nowLA = DateTime.now().setZone(TZ);
  // We run on a schedule, but only publish at 06:00 LA time.
  if (process.env.FORCE_UPDATE !== "1" && nowLA.hour !== 6) {
    console.log(`[skip] It's ${nowLA.toFormat("HH:mm")} in ${TZ}; only updating at 06:xx.`);
    return;
  }

  const datePretty = nowLA.toFormat("cccc, LLLL d, yyyy • h:mm a ZZZZ");
  const dateStr = nowLA.toISODate();

  // Seed “daily” randomness by date for stable output within the day.
  const seed = Number(dateStr.replaceAll("-", ""));
  const rand = mulberry32(seed);

  const meme = await findDailyMeme();
  await downloadToFile(meme.imageUrl, MEME_PATH);

  const headlines = await buildHeadlines(dateStr, rand, meme.title);

  fs.mkdirSync(SITE_DIR, { recursive: true });
  const html = renderHtml({ datePretty, meme, headlines });
  fs.writeFileSync(path.join(SITE_DIR, "index.html"), html);

  fs.writeFileSync(
    path.join(SITE_DIR, "data.json"),
    JSON.stringify({ updatedAt: nowLA.toISO(), tz: TZ, meme, headlines }, null, 2) + "\n"
  );

  console.log(`[ok] updated site for ${dateStr} (${TZ})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
