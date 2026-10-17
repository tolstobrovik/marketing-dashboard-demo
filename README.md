# SATashkent Marketing Dashboard — demo copy

This is a copy of the marketing team's dashboard
(marketing.satashkent.uz) for design work. It runs only on your own
computer, on a made-up team with six weeks of made-up work. It cannot reach
the team's real data: there is no connection to the live database, to
Google Drive, Telegram or any AI service.

Click through everything, break things, change the code. Nothing you do here
reaches the real team.

## See every screen at once

Open **`design-overview/index.html`** in a browser (double-click it). It is a
board, like a Figma page: every screen of the app, one row per kind of
person (admin, content maker, copywriter, operator, editor, designer,
operator-and-editor), at real size, plus phone views.

- Drag to move, Ctrl + mouse wheel (or pinch) to zoom, **Fit all** to see everything.
- Click a screen to open it large; ← → go through them in order.
- Double-click a screen to zoom the board to it.
- The chips at the top hide or show a person's row.

## Run it yourself

You need [Node.js](https://nodejs.org) 20 or newer (the LTS download is fine)
and Git.

```bash
git clone https://github.com/tolstobrovik/marketing-dashboard-demo.git
cd marketing-dashboard-demo
npm install
npm run demo
```

The first `npm run demo` builds the demo database (half a minute), then starts
the app. Open **http://localhost:5173**. `Ctrl + C` in the terminal stops it.

**Password for every account: `demo-team-2026`**

| Sign in as | Who they are | What they see |
| --- | --- | --- |
| `admin` | Admin | Everything: the day of the whole team, every channel, the admin panel |
| `dilnoza` | Content maker (SMM), Instagram Main and YouTube | Plans pieces, books shoots, checks the edits |
| `sardor` | Content maker, Instagram Uzb | Same, on the Uzbek channel |
| `malika` | Copywriter, Telegram, LinkedIn, X, Threads | Text-only channels |
| `javohir` | Targetologist | Ads |
| `otabek`, `bekzod` | Operators | The shoots they are booked for |
| `eldor`, `kamola` | Editors | The edits waiting for them |
| `nigora`, `shahzoda` | Designers | Covers and artwork |
| `aziz` | Operator and editor | Both jobs |

The language (English, Russian, Uzbek) and the dark theme are the buttons at
the bottom of the sidebar.

### A fresh board

The demo's dates are built around the day you create it: some shoots are
today, some pieces are late on purpose. After a week or so the board drifts.
For a fresh one whose days line up with today, stop the demo (`Ctrl + C`) and:

```bash
npm run demo:reset
```

### New screenshots for the board

After changing the design, take the board's pictures again. With the demo
running in one terminal, in a second terminal:

```bash
npm run screens
```

It uses Chrome or Edge, whichever is installed, and takes about three
minutes. `LANG=ru npm run screens` takes them in Russian.

## Where things are

- `client/src/pages/` — one file per page; `client/src/components/` — the parts.
- `client/src/styles.css` — every colour, size and font is a token at the top
  of this file. The "Coach look" (the current one) is the `co-` classes and the
  sections marked r8 / r10 / r14.
- `client/src/lib/i18n.jsx` — every word in the three languages.
- `CLAUDE.md` — the design rules the app follows (the Coach look and the
  SATashkent brand book). Read it before redesigning a screen.
- `server/` — the API. You should not need to touch it for design work.

The page changes as you save a file; no restart needed.

## If something goes wrong

- **`npm install` warns about "allow-scripts"** — harmless; the app still runs.
- **Port 4000 or 5173 is busy** — another copy is still running. Close that
  terminal and try again.
- **The page says it cannot reach the server** — the terminal running
  `npm run demo` was closed. Start it again.
- **The board is empty** — stop the demo and run `npm run demo:reset`.
