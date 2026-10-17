// The privacy policy, at /privacy: public, plain HTML, no script. Google asks
// for one before an app that reads Drive can be published, and it has to load
// for somebody who is not signed in, so Express serves it ahead of the sign-in
// wall and the single-page app. The colours are the brand book's own.
//
// Change the words here, and the date below with them.
const UPDATED = '14 October 2026'
const CONTACT = 'satashkentmarketing@gmail.com'

export const privacyPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy · SATashkent Marketing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">
<style>
  :root { --ruby: #A22036; --near-black: #262626; --mid-grey: #B6B6B7; --light-grey: #E9E9E9; --white: #FFFFFF; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--white); color: var(--near-black); font: 16px/1.6 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  header { background: var(--ruby); color: var(--light-grey); padding: 28px 16px; }
  header p { margin: 0; font-size: 14px; }
  main, header > div { max-width: 720px; margin: 0 auto; }
  main { padding: 8px 16px 48px; }
  h1, h2 { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; line-height: 1.25; }
  h1 { margin: 0 0 6px; font-size: 30px; }
  h2 { margin: 32px 0 8px; font-size: 21px; padding-top: 16px; border-top: 1px solid var(--light-grey); }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  a { color: var(--ruby); }
  footer { max-width: 720px; margin: 0 auto; padding: 16px; border-top: 1px solid var(--mid-grey); font-size: 14px; }
</style>
</head>
<body>
<header><div>
  <h1>Privacy policy</h1>
  <p>marketing.satashkent.uz · last updated ${UPDATED}</p>
</div></header>
<main>
  <h2>Who runs this app</h2>
  <p>marketing.satashkent.uz is the workflow board of the SATashkent marketing team in Tashkent, Uzbekistan. The team plans, films, edits and publishes its content here. It is an internal tool: only people the team has given an account can sign in. Contact: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>

  <h2>Which Google data it uses</h2>
  <p>An admin of the board connects one Google account (the team's own) to the app. With that connection the app uses Google Drive in two ways, and no others:</p>
  <ul>
    <li><b>Files it uploads</b> (scope <code>drive.file</code>). When a team member uploads footage, an edit or artwork from a task, the app puts the file in a folder it created in that Google Drive and keeps the link on the task.</li>
    <li><b>A read-only listing of three drop folders</b> (scope <code>drive.readonly</code>). The app looks inside the folders “SATashkent Marketing drop / Recording”, “Pravka” and “Ready” to show each file's name, size, type, preview picture and link on the team task it belongs to. It does not read any other folder, and it never changes, moves or deletes a file it did not create.</li>
  </ul>
  <p>It also reads the connected account's email address, to show the admin which account is connected.</p>

  <h2>Where the data stays</h2>
  <p>The files themselves stay in Google Drive. The app's database keeps only the metadata named above (the file's Drive ID, name, size, type, link, video length and whether a preview exists) next to the task it belongs to. Preview pictures are fetched from Google when someone opens the task and are not stored. The key Google gives the app for the connection is kept on the app's server, outside the database, and is readable only by the app.</p>

  <h2>Who sees it</h2>
  <p>Only signed-in members of the SATashkent marketing team, and only on the tasks they work on. We do not sell, rent or share this data with anyone, we do not use it for advertising, and we do not use it to train AI models.</p>

  <h2>What the board records about its own users</h2>
  <p>To find where the board is hard to use, it records, for each signed-in team member by name, the pages they open, where on a page they press and what the pressed button or link says, the messages the board shows them, and when they open and close a task. It never records what anybody types into a box. These records are kept on the app's server, outside the database, are read only by the board's admins, and are never shared or sent to Google.</p>

  <h2>Google API Services User Data Policy</h2>
  <p>marketing.satashkent.uz's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

  <h2>How to stop it</h2>
  <ul>
    <li>In the connected Google account: <b>Google Account → Security → Third-party apps with account access</b> (Third-party access), choose this app, and remove its access.</li>
    <li>Or, as an admin of the board: <b>Admin → Google Drive → Disconnect</b>. The app gives the key back to Google and forgets it.</li>
  </ul>
  <p>Files already in Google Drive stay there either way; they are yours.</p>

  <h2>Asking for deletion</h2>
  <p>To have the metadata the app keeps about your files deleted, or to ask anything about this policy, write to <a href="mailto:${CONTACT}">${CONTACT}</a>. We answer within 30 days.</p>
</main>
<footer>SATashkent Marketing · <a href="/">Sign in</a></footer>
</body>
</html>
`
