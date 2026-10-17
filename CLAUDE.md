# Working on this repository

This is the **demo copy** of the SATashkent marketing dashboard, for design
work. It runs only on this computer, on made-up data (`npm run demo`, see
README.md). There is no deploy, no server and no shared database here:
`server/config.js` has no GitHub storage, and the app always uses the local
SQLite file `data/dashboard.db`, rebuilt by `npm run demo:reset`.

- Never add a real token, password or address of the team's server to this
  repository.
- `design-overview/` is the board of every screen; `npm run screens` takes
  its pictures again (the demo must be running).
- Design changes made here go to the real dashboard by hand, through its own
  repository's pull requests. The rules below are the real dashboard's rules,
  and they hold here too.

## The Coach look

Since October 2026 the pages a new person lands on **guide them**: My Day, the
task window and a content maker's calendar are the Coach look, on by default,
with the previous look behind a per-person switch ("Bring back the previous
look", under More). There are two looks, not three — the Coach look replaced
the first "one list, one button" look outright, after the owner found that one
"too simple and not even guiding". The channel page and the new task form keep
their simple shape and open the same task window.

**Round 8 (8 October 2026) gave it the shape the owner chose from mockups**
("task view 1, first menu 3, new idea and moving 3, recording time 1"):

- **My Day** is a headline ("{name}, start here."), the start-here card (with
  the place to drop the file when it can be handed in now) and the rows. No
  summary chips, no "how this page works". (Round 8 put a strip of hours under
  the headline, "the day as a line"; round 11 took it out.)
- **The task window** is wide; on a desk two columns — first, on the left,
  what this person does (their one step, what was asked, the talk), and beside
  it the material (what was made, the reference). No numbered steps. (Round 8
  had three columns, "compare", with the step last.)
- **The stages line** (`Capsule` in `components/CoachBits.jsx`) is drawn only
  for whoever follows a piece across stages — an admin, an owner of the piece,
  a person with two crew jobs (`tracks`). A person with one job sees their
  turn and its day.
- **A board card has one tonal button, the next step.** Pressing it, dropping
  the card on another lane, or "Move to…" asks the server what is missing and
  draws it **one question at a time** in a small panel at the card
  (`NextStep` with `ask`). Who films, the day and the hours are one question
  (`components/TimeBand.jsx`): rows of buttons — see round 11.
- **A new idea is a name and the idea** (`components/QuickTask.jsx`); the
  channel decides the form (a written channel asks the text and the day); the
  later questions are offered below at half strength, never required.
- **The rules of a filmed piece** (server, pinned by `qa/r8-rules-suite.mjs`):
  To shoot asks who films, the day, the hours and the script; the stage after
  asks the reference, the ТЗ, who edits and the day to post; footage handed in
  with the ТЗ and the editor already there moves the piece on by itself,
  otherwise it stays on To shoot and is its owner's step ("Send to editing");
  hours are stored on the quarter hour.
- **One sidebar for everybody** in this look, channels grouped by network
  with what is late (else what is in editing) beside each
  (`GET /content/counts`); the look's tokens and shared pieces are scoped to
  `html[data-look="coach"]` (`lib/look.js`), the "r8" sections of `styles.css`.
- "Edits", never "cuts", in every word a person reads.

**Round 9 (8 October 2026) made it lighter**, after the owner saw round 8 on a
real day: "too complex — simplify everything, every single window".

- **Nothing is said twice.** A row is its title, one short line (for whom, or
  who has it) and one badge or one button. The kind of work is the tile, the
  day or the lateness is the badge.
- **A long list shows its first rows** (five; four in a maker's group) and
  "Show all {n}". Groups carry no number and no sentence of explanation.
- **The start-here card** is the title, one reason and the button.
- **An admin's day** is the deadlines; "Who is where" is folded shut, and the
  channels are one menu, not a row of buttons. The design board has the same
  menu.
- **The strip of days is for whoever films.** Everybody else's days are the
  bands of the list.
- **The task window** keeps reposts, the file name and the full sheet under
  one "More" fold; the new idea keeps its optional questions under a fold.
- **Check a screen on a crowded day before shipping it** — forty late pieces
  and long titles, not the six rows of the seed. Round 8 looked calm on the
  seed and did not on the live data.

**Round 10 (9 October 2026) carried the same rules to the other pages** — the
ones the Coach look had only recoloured ("simplify them as well, do it fully
this time"). Its styles are the "r10" section at the end of `styles.css`.

- **A row of channel buttons is one menu everywhere**: the Master Calendar and
  Recordings (`pages/Schedule.jsx`), Statistics, the design board, an admin's
  day. Several channels at once still work from the address, which is how a
  campaign's lens sets them.
- **The calendars**: the four filters wait behind a "Filter" button; the
  overdue strip is one line (three chips, then "Show all"); a chip wears its
  stage as a tint, with the stage's own colour as the rule on its left.
- **Team**: the team first; no number tiles; a card says what is filled in,
  never "no phone yet". Hiring and Candidates are under it, shut
  (`Fold` with `shut`) — the owner means to remove them.
- **Admin panel**: five tabs and one "More…" menu (`more: true` in `TABS`).
- **Post Production**: one plain sentence instead of a headline card, one
  menu for the person, no count that is nought.
- **Profile**: no "Missed deadlines" (the owner's decision); theme, language
  and text size are one fold, shut.
- **The full task sheet** still opens whole — it was folded once and people
  reported the rest as missing. Its status line only names a phase that has
  a person or a day.
- **Everybody's home is My Day.** An admin no longer lands on the Overview,
  which has been in nobody's menu since the Coach look.

**Round 11 (9 October 2026) rebuilt the parts the team would not have
understood** — the owner: "not just slimming the buttons but the actual
redesign of the hard parts that will be misunderstood by the team… keeping
only the most needed updates". Two of round 8's own picks went.

- **What a person cannot start is not theirs to be late on.** The crew's
  bands (Overdue, Today, Coming up) hold only what they can do; a cut with no
  footage, a piece not sent on, a booking they said no to are one group below,
  "Waiting for others" — with its count, each row naming whom it waits
  for and still saying how late. The states are `crewDay`'s (`blocked`,
  `early`, `declined`); the screen only groups them. An admin's day still
  counts every late step.
- **Everything assigned to a person is on their screen** (13 October 2026,
  after an editor could not find a task that was his). On the crew's page
  Overdue and Today are never cut; only "Coming up" and "Done today" show
  five and "Show all" (`CUT` in `CoachCrewDay.jsx`); "Waiting for others"
  starts open, shows every row, and can be folded.
- **"Handed in" is where the piece stands, not a stamp.** The server stamps
  `ready_at` the first time a piece reaches Ready and keeps it when the card
  moves back — it is the clock of the first delivery. So a piece standing on
  the making stage is handed in only while a change round is open (the server
  sent it back for one seat; the other's work is still done). With no round
  open it was put back by hand, re-shot or given a new editor (`putBack`), and
  it is work again for whoever the stage belongs to — the editor where the
  piece has one, else the designer: `makeDone` in `lib/coach.js`, read by My
  Day, the task window and the crew's calendar. Read as done, such a piece
  was on no list of its editor at all. It is read the way a change sent back
  is: never late by the day of the delivery it already met, first in its
  band, and its hand-in box starts empty. The server still counts the first
  delivery: no new reminder, and nobody is late again.
- **A name comes after a colon** ("Waits for the footage: Otabek"), never
  inside a clause: it would need a case in Russian and in Uzbek.
- **A booking question is answered on its row**: "Can you? today, 15:30",
  Yes, No.
- **Choosing the recording time is rows of buttons** — the day, the start
  (every half hour), how long, who films — where round 8 had a band to drag
  on. A start somebody is busy at is struck through and still pressable; the
  reason and the nearest free time are then written under it. Any other time
  is typed under "Another time", to the quarter hour.
- **My Day has no strip of hours.** A shoot is a row with its hour.
  `CoachDayLine.jsx` is gone.
- **A filmed piece still on "To shoot" says it is filmed**, to everybody:
  "Filmed — send it to editing" to whoever can, "Filmed. Waiting: {name}" to
  the rest.
- **"What changed"** (`WhatsNew` in `CoachParts.jsx`) is a few lines on My
  Day, once a person a release: the team said updates came unannounced. Give
  it a new `id` and new lines when a release changes how something is done.

**Round 13 (14 October 2026)**, after the one task window went live (#78) —
the owner's 16 points. The parts that change how a screen looks wait for the
owner's pick from mockups (`.arena/designs/r13-*`); these went straight in:

- **The step box scrolls with the comments** in the task window; nothing is
  stuck to the top of the right column.
- **A reference is a preview** (`LinkPreview` in `LinkView.jsx`: a reel or
  post small, a video's picture, any other site as its name), and every link,
  video and picture opens in the middle of the page over a dimmed, half
  see-through backdrop — never the browser's own full screen. A picture
  zooms (`PanZoom` in `Zoom.jsx`: wheel, pinch, drag, double click, + − 0).
- **Empty is not drawn.** No reference, no files: the blocks are hidden and
  the window goes straight to the ТЗ. Only the task's owner keeps one small
  "+ Add" line; everybody else changes them through Edit.
- **The new-task form** (`builder/TaskBuilder.jsx`): "Save for now" on every
  step but the last makes an Idea with whatever is filled (`draftOf`, never
  moved on by itself). The shoot, the editor and the cover are switches on the
  When step (`want`), off unless the page or a draft already said who; only
  what is turned on becomes a step.
- **An admin hands in for the person on the step** ("Upload instead of
  them" in the window). The seat keeps the credit and the pay: both are read
  off `operator_id`/`editor_id`/`designer_id`, never off who pressed.
- **Uploads on every page** (`UploadsDock.jsx`, mounted in `main.jsx`): a
  card in the corner like Google Drive's while files go; toasts sit above it.
- **Where people struggle is recorded, by name** (the owner's decision; the
  team is told in "What changed" and on `/privacy`). `lib/track.js` sends
  pages, presses (the label of what was pressed — never what is typed), the
  board's "no"s, task windows opened/changed/closed and empty searches;
  `server/routes/track.js` keeps a file a day in `DATA_DIR/track/` (beside
  the database, never inside it — it is pushed to GitHub whole) and writes
  the daily and weekly Markdown report and the heatmap's dots, admins only.
  Read and download them under Admin → Usage; a page opened with
  `?heatmap=<days>` draws its presses over itself (`HeatmapOverlay.jsx`).
  Pinned by `qa/track-suite.mjs`.

- The switch is `client/src/lib/look.js` (`useSimpleLook` — the name it
  shipped with). It is a browser preference, not a permission: every rule is
  the server's under both looks.
- **What to do first, and whose step it is,** is read in one plain module,
  `lib/coach.js`, and pinned by `qa/coach-suite.mjs` on a worked day: the
  crew's list in the order to do it and its "Start here" (`crewDay`), a maker's
  pieces in their five groups (`makerDay`), what the task window offers a
  person (`actOf`), a day's shoots and releases (`dayEvents`), the stops of a
  task and who does each (`wayOf`). The screens draw that reading; they do not
  make one of their own.
- **A number means "you can do this now".** A job on a piece its maker is
  still planning (before `ideaEndOf` — not yet sent to the shoot or the
  designer) is listed with a clock and "Not sent to you yet", never numbered
  and never "Start here"; so is an edit with no footage and a shoot on a later
  day. The window still lets the job be handed in ("Already made it?"),
  because the server takes it. A booking question and a change sent back are
  numbered at any stage: somebody is waiting. A **yes** to a booking does not
  change that: the job is theirs only once the maker has sent the piece on.
  A booking they said **no** to (and still hold the seat of) is the maker's
  step at any stage: a clock, "You said you can’t", and the window shows the
  answer with a way to change it — never a hand-in.
- **A move names whoever holds the stage it lands on.** The server takes
  "Send to the shoot" with no operator and "Start the work" with no editor;
  the piece would then sit on a stage with nobody to make it. `seatAt` reads
  the landing stop off `wayOf`, and the move's form (`NextStep`, `seat`)
  keeps its button asleep until that one name is given. A stage the piece only
  passes is offered, not demanded. This is the page's promise, not a server
  rule.
- **A change sent back is for today, and is never "late" by the day of the
  delivery it follows.** The server keeps no deadline for a fix; its day is
  `fixUntil` — the next day the piece is still promised for (the seat's own
  day while that is ahead, else the release day), never a day already gone.
  The crew's row, the maker's "Being fixed" row and the window all read it
  there.
- **"Why this one first" has to be true.** `crewDay` also returns `held` —
  what is late and cannot be started — so the big card says "what is late
  can't be started yet…" instead of "nothing is late" over an overdue row.
- The window never goes away over words typed and not sent without asking —
  closing, the full task sheet and "Next" alike. After a press that moved the
  piece it offers **Undo** for nine seconds: the server's own
  `POST /content/:id/undo` (ten seconds, whoever made the move), the one the
  board's toast uses. "Remind" is a comment that names the person: once a day
  per person per task — read off the thread as the reminder line itself, not
  as any mention of the name — in the reader's language. It is posted with
  `remind: true`, so the server rings only the person it names; the line
  stays in the thread.
- The screens are `components/CoachCrewDay.jsx` (the headline, the line, the big
  card, the list in the order to do it), `CoachMakerDay.jsx` (the same, with the
  five groups — filming today, pravka, late, your move, ready to publish — under
  the day in view), `CoachAdminDay.jsx`, `CoachCalendar.jsx` (`/brief/calendar`: a
  maker’s month, shoots and releases together) and `CoachTask.jsx` (the task
  window — one for crew and makers, in from the right, opened from My Day and
  from a channel page). Their shared pieces are `CoachParts.jsx` and
  `CoachBits.jsx`.
- A piece's one button is still its **next step** — `lib/nextStep.js` says
  what it is and whose (`qa/nextstep-suite.mjs` pins it). The window asks the
  server what the step is missing and draws only those questions:
  `components/NextStep.jsx` (a dry run plus the handover, plus the landing
  seat above) and
  `components/HandIn.jsx`, both drawn `inline` under "Your step now". Do not
  copy a server rule into any of them.
- New UI in this look: plain words in all three languages; every button says
  what happens after it ("After you press: …") and every empty place says why
  it is empty. A colour for the kind of work (`--kind-shoot`, `--kind-cut`,
  `--kind-art`), ruby only on the one button to press and on what is late.
  Every class starts `co-`.
- Nothing is taken away by it: what a page no longer shows is under More.
- The previous look is temporary (`CrewDay.jsx` and the classic branches of
  `Brief.jsx` and `Department.jsx`). When it is removed, `look.js`, those and
  the switch go together.

## Brand

Every screen follows the SATashkent **BRAND BOOK v1** (August 2026), and
`qa/brand-suite.mjs` checks it on every pull request. Keep new UI simple and
minimal.

- **Colour:** only the tokens at the top of `client/src/styles.css`.
  - Ruby `#A22036` is the one red.
  - Bright red `#CB3351` is the accent and never sits on ruby.
  - Near black `#262626` is for text.
  - Mid grey `#B6B6B7` is for rules and fills, never for text.
  - Light grey `#E9E9E9` is for backgrounds, and white is the base.
  - Type on ruby is light grey, not white.
  - Never write a new hex; add a token instead.
- **No gradients** in the identity.
  - The stage tints (`--st-*`) are status colours, like the type chips; late
    and the tonal ruby (`--primary-soft` and its family) are ruby mixed, never
    a second red.
- **The sidebar** is neutral (the soft ground, `--soft`) in the Coach look and
  ruby in the previous one. In the Coach look ruby is the one strong colour:
  the button to press, where you are, what is late.
- **Type:**
  - The page headline is Nekst (`--font-display`), everything else Inter; the
    owner confirmed the web licence on 7 October 2026. "The page headline" is
    one per page, plus large numbers (`.co-title`, `.co-bignum`); a window's
    title, a question and a group's heading are Inter.
  - Nekst is served from `client/public/fonts/` (SemiBold and Bold only). It
    sets Latin and Russian and has no Uzbek `ʻ` `ʼ`: those fall to Inter, the
    next face in the stack.
  - Nothing is heavier than 700.
  - The wordmark is still the logo artwork, never typed in Nekst.
- **Logo:** `components/Logo.jsx` shows the brand book's own artwork from
  `client/public/brand/`, used as masks: ruby mark with near-black type, or all
  light grey on ruby or a dark ground.
  - Never redraw the logo, recolour it, box it or re-type the wordmark.
  - The files were cut from the PDF's cover lockup (L3) and page 6 (L2). Ask
    for missing formats rather than making them.
- **Uzbek:** `oʻ`/`gʻ` use U+02BB and the tutuq belgisi uses U+02BC, never `'` or `‘`.
