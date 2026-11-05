# CareSchedule

An offline weekly scheduler for domiciliary care runs. It works on **Windows and Mac** with **no internet**, and optionally
shares one rota across the office computers and work phones – either from a **Google Drive folder** (one person at a time)
or through **Supabase** with **iPhone and Android** apps (see *Google Drive version*, *Shared storage* and *Phone apps*).

## Desktop app (recommended)

The desktop app saves everything to a data file on the computer and keeps daily backups, so nothing is lost
if the browser is cleared.

**Download:** on GitHub, open **Actions → Build desktop app**, click the latest successful run and download
**CareSchedule-Windows** (installer `.exe`) or **CareSchedule-macOS** (`.dmg`) from *Artifacts*.
When a version tag such as `v1.0.0` is pushed, the same files are also attached to a **Release**.

- **Windows (portable – nothing to install):** `CareSchedule-Portable-….exe`. Put it in any folder or on a USB stick
  and double-click it. Its data, backups and settings are kept in a **CareSchedule Data** folder next to the `.exe`, so
  to move to another computer just copy the `.exe` and that folder together. (It takes a few seconds longer to start
  than the installed version.) Close CareSchedule before unplugging a USB stick, and keep an *Export backup* elsewhere
  in case the stick is lost.
- **Windows:** run `CareSchedule-Setup-….exe`. Windows may show "Windows protected your PC" because the app
  isn't code-signed: click **More info → Run anyway**.
- **Mac:** open the `.dmg` and drag CareSchedule into Applications. The first time, right-click the app and
  choose **Open** (it isn't signed by Apple). If macOS says it is "damaged", run
  `xattr -cr /Applications/CareSchedule.app` in Terminal, then open it again.

**Your data** is saved to `Documents/CareSchedule/careschedule-data.json` after every change. The first
change each day also copies the previous file into `Documents/CareSchedule/backups/`, keeping the last 30 days.
**Settings & Data → Open data folder** shows the folder. If the data file is ever damaged, the app restores
the newest backup automatically and says so.

**Sharing with the office through Google Drive:** install *Google Drive for desktop* on each computer, then in
CareSchedule go to *Settings & Data → Change data folder…* and pick the same shared Drive folder on every computer
(right-click the folder in Drive and choose *Available offline* so it keeps working without internet).
Only one computer can make changes at a time: the others open it **view only**, see who has it open, and update
automatically when that person saves. When they close CareSchedule, the next computer can edit (straight away with
*Try again*, or automatically within a minute). A lock left behind by a computer that crashed or lost power is taken
over after 3 minutes. If Drive ever delivers someone else's copy while you are editing (e.g. two people opened it at
the same moment before Drive had synced), your version is kept and theirs is saved next to it as
`careschedule-data.from-another-computer-….json`.

**Moving over from the browser version:** in the browser, *Settings & Data → Export backup*; in the desktop
app, *Settings & Data → Import backup*.

To build it yourself: `cd desktop && npm ci && npm start` (run) or `npm run dist` (installer for the
computer you're on).

## Browser version

`CareSchedule.html` also works on its own in Edge, Chrome, Firefox or Safari – nothing to install.

1. Copy `CareSchedule.html` to a fixed place on the computer (e.g. Documents) and double-click it.
2. Go to **Settings & Data → Load sample data** to try it out, or add your own carers and runs.
3. On **Schedule**, pick the week and press **Auto-fill week**.

In the browser, data is saved in that browser on that computer. Use **Export backup** regularly (and to move
data to another computer), and **Import backup** to restore. Always open the file from the same location
in the same browser, otherwise the browser treats it as a fresh copy.

## Google Drive version – one person at a time, nothing else to sign up for

The rota can also run entirely from a **Google Drive folder**: a small Google Apps Script (in
[`apps-script/Code.gs`](apps-script/Code.gs)) serves the page as a private web link, and the data is a file in that
folder. Staff open the link on any computer or phone and sign in with their normal Google account.

- **Only one person can have the rota open at a time.** Anyone else who opens the link sees *🔒 In use – Sarah has the
  rota open on iPhone (since 9:05)* and is kept out. Their page checks every 15 seconds and opens the rota for them as
  soon as it's free. They can press **Ask them to close it**: Sarah is asked, and can close it with one tap.
- It frees up when the person presses **Close** at the top, after **15 minutes without use**, or **90 seconds** after
  their device stops checking in (the tab was closed or the phone went to sleep).
- The same person opening it on a second device can choose **That's me – open it here instead**.
- Every change is saved to Drive straight away. The first save each day keeps a copy in a **backups** folder (last 30 days).
- **Who can use it** is simply who the folder is shared with.
- It needs a connection (nothing works offline), and phones use the link in the browser rather than the phone apps.

### Setting it up (about 10 minutes)

1. In Google Drive make a folder, e.g. **CareSchedule**, and upload **`CareSchedule.html`** into it. **Share** the
   folder with everyone who uses the rota, as **Editor**.
2. Open the folder and copy its ID – the long code at the end of the address, after `/folders/`.
3. Go to [script.google.com](https://script.google.com) → **New project**, name it *CareSchedule*. Replace everything in
   `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs), paste the folder ID into
   `FOLDER_ID` at the top, and press **Save**.
4. **Deploy → New deployment →** ⚙ **Web app**. Set *Execute as* to **User accessing the web app** and *Who has access*
   to **Anyone with a Google account**, then **Deploy**. Copy the **Web app** link and send it to the staff.
   (Only people the folder is shared with can actually open the rota; anyone else is told they don't have access.)
5. The first time each person opens the link, Google asks them to allow it to use their Drive (that's where the rota
   is). Because it's your own private script rather than a published app, Google shows *"Google hasn't verified this
   app"* – click **Advanced → Go to CareSchedule** and **Allow**.
6. **On phones:** open the link in Safari or Chrome and choose **Add to Home Screen**, so it opens like an app.
7. **Bringing in your existing rota:** in the desktop app *Settings & Data → Export backup*, then in the Google Drive
   version *Settings & Data → Import backup*. (The Google Drive version keeps its own file,
   `careschedule-online.json`, so it never clashes with the desktop app's data file.)

**Updating** to a newer `CareSchedule.html`: in the Drive folder, right-click the file → *File information → Manage
versions → Upload new version* (or upload it again – the newest copy is used). There's no need to deploy again. Only
redeploy (*Deploy → Manage deployments → Edit → New version*) if `Code.gs` itself changes.

## Shared storage – one rota on every device

Instead of the data living on one computer (or in Google Drive), it can be kept in **Supabase** (a hosted database), so
the office computers, browsers and work phones all share **one rota**. Whoever makes a change, everyone sees it within a
few seconds.

- **One editor at a time.** The first person to make a change becomes the editor. Everyone else sees *View only – Sarah
  is editing on iPhone* and can press **Ask to edit**: Sarah is asked to hand over, and if she agrees (or has made no
  change for 10 minutes, or her device has gone quiet for 2 minutes) the asker takes over. **Done editing** hands it back.
- **No connection:** the last copy downloaded stays on the device and can be viewed, but can't be changed until it's
  back online.
- **Who can get in:** only people you add to the staff list, each signing in with their own email and password.
  Supabase keeps a copy of the rota each day for 30 days.

### Setting it up (once, about 15 minutes)

1. Create a free account at [supabase.com](https://supabase.com) and a **new project**. Choose the **London (eu-west-2)**
   region so the data stays in the UK, and keep the database password somewhere safe.
2. In the project, open **SQL Editor → New query**, paste in the whole of [`supabase/setup.sql`](supabase/setup.sql) and
   press **Run**.
3. Add your office staff to the staff list – in the SQL Editor run one line per person:
   ```sql
   insert into public.cs_staff (email, name) values ('sarah@yourcompany.co.uk', 'Sarah');
   ```
   (To remove someone: `delete from public.cs_staff where email = 'sarah@yourcompany.co.uk';`)
4. Give each of them a sign-in: **Authentication → Users → Add user → Create new user**, with their email, a password,
   and *Auto Confirm User* ticked. Then in **Authentication → Sign In / Providers**, turn **off** *Allow new users to
   sign up*, so nobody else can create an account.
5. Note the **Project URL** (*Project Settings → Data API*) and the **publishable key** (*Project Settings → API Keys*;
   older projects call it the *anon public* key). These are safe to put in the apps – the staff list and the rules in
   `setup.sql` are what keep the data private.

### Connecting each device

- **Desktop app or browser:** *Settings & Data → Shared storage*, enter the Project URL and key, press **Connect** and
  sign in. On the **first** device, if the shared storage is empty, press **Upload this device's data** to start it off
  with your existing carers, runs and history (or *Load sample data* to try it out).
- **Phone apps:** put the URL and key in `apps/config.json` before building (below), and staff only have to sign in. If
  you leave it blank, they enter it once under *Settings & Data* like the desktop.

Carers' names, availability and sickness are personal data, so keep the staff list to people who need it, use strong
passwords, and add Supabase to your GDPR records as a data processor (their Data Processing Agreement is in the
dashboard under *Organization → Legal Documents*).

## Phone apps (iPhone and Android)

`apps/ios` (Xcode) and `apps/android` (Android Studio) are small native apps that show the same `CareSchedule.html`
full screen, so every rule and feature is the same as on the desktop – there's only one copy of the app to keep up to
date. On a phone the schedule shows **one day at a time** as cards: tap a day or **swipe** left and right, and
**More** opens the other schedule tools. The native side adds the phone's **share sheet** for files and PDFs (WhatsApp,
email, Save to Files / Drive), **printing**, and pop-up messages. They use the shared storage above, so set that up first.

Nothing is published to the App Store or Google Play.

**Before building:** fill in `apps/config.json` with your Project URL and publishable key (optional, see above).

### iPhone (Xcode, on a Mac)

1. Open `apps/ios/CareSchedule.xcodeproj` in Xcode (16 or later).
2. Click the **CareSchedule** project → target **CareSchedule** → **Signing & Capabilities**: choose your **Team** and
   change the **Bundle Identifier** (`uk.careschedule.rota`) to one of your own, e.g. `uk.co.yourcompany.careschedule`.
3. To put it on a phone that's plugged in: choose the phone at the top and press **Run** (▶). The phone needs
   *Developer Mode* turned on (Settings → Privacy & Security), and the first time *Settings → General → VPN & Device
   Management → trust your developer account*.
4. For the office's phones without plugging each one in, use **TestFlight internal testing**: *Product → Archive →
   Distribute App → TestFlight Internal Only*. In App Store Connect add staff as internal testers (they need to be
   users on your developer account); they install the **TestFlight** app and get the CareSchedule from there. Internal
   builds are never reviewed or shown on the App Store. Each build lasts 90 days, so upload a new one before then.
   (If your account is an *Apple Developer Enterprise* account, you can instead export an in-house `.ipa` and share it
   through your device management.)

### Android (Android Studio)

1. Open the `apps/android` folder in Android Studio and let it sync.
2. To try it: plug in a phone with *USB debugging* on (or start an emulator) and press **Run** (▶).
3. To install on the office phones: *Build → Generate Signed App Bundle or APK → APK*, create a key the first time
   (keep the `.jks` file and its passwords safe – every later update must be signed with the same key), and send the
   `.apk` to the phones (email, Drive or your device management). On the phone, allow *Install unknown apps* for the app
   you open it from. If you use **Google Play managed private apps** through your device management, the same app can be
   pushed that way without appearing in the public Play Store.

### Builds on GitHub

**Actions → Build phone apps** builds both apps after every change, so you know they still compile, and checks the
shared-storage rules. The Android `.apk` is under the run's *Artifacts* (**CareSchedule-android**). To have GitHub sign
it with your own key (so updates install over the top), add these repository secrets under *Settings → Secrets and
variables → Actions*: `CS_KEYSTORE_B64` (the `.jks` file as base64: `base64 -i office.jks | pbcopy` on a Mac),
`CS_KEYSTORE_PASSWORD`, `CS_KEY_ALIAS` and `CS_KEY_PASSWORD`. The iPhone build there is for the simulator only;
installing on iPhones is always done from Xcode with your developer account.

## Features

- **Carers** – add, edit, remove (or mark inactive). Each has gender, driver / non-driver, days per week,
  an agreed +1 overtime day, whether they can go on double-ups, singles or both, which weekdays they can work, dated annual leave / sickness, **Preferred runs** (tick **Only these runs** for a carer who
  only ever does a specific run), and a **Can't work with** list (e.g. a married couple) – they are never put
  on the same run on the same day. It applies both ways, so it only needs setting on one of them.
  The carers list shows whether each person is due a weekend off, and flags anyone who has worked 2 weekends
  in a row as **⚑ Weekend off priority**.
- **Agency staff** – a separate section on the Carers page (**+ Add agency worker**). Agency workers are only
  used after everything else, to fill shifts no regular carer can cover. They never take a shift from a regular
  carer and don't affect regular carers' weekends, run rotation or days off. Their days per week is the most
  they can be booked; the hard rules (driver, gender, leave, days in a row, can't work with…) still apply.
  Can be switched off in Settings.
- **Runs** – add, remove, rename, reorder. Double-up (2 carers) or single (1 carer); male only, female only,
  or either; untick days a run doesn't operate. Runs need a driver unless "Needs a driver" is unticked.
  **Only these carers** limits a run to named people (e.g. a run covered by 3 non-drivers).
- **Schedule** – Monday to Sunday grid. Pick carers by hand (the slot is then 🔒 locked and auto-fill
  leaves it alone), add a 3rd shadow / training carer, copy the previous week, print, export CSV.
  Problems are highlighted in red (e.g. no driver, double booked, on leave) and amber (overrides, overtime).
- **Plan several weeks** – *Auto-fill [2/4/6/8] weeks* plans this week and the following ones in date order
  (each week uses the ones before it); finalised weeks are skipped.
- **Leave planner** (Leave page) – book annual leave or sickness and press *Check cover* first: day by day it shows
  roughly how many carers, drivers and male/female staff would be around against the shifts to cover, and flags any
  day that would be short. Below it, a calendar of who's off over the next 4, 8 or 13 weeks, with days likely to be
  short of staff in red.
- **Trainees** – on a new starter's page set *Trainee – only shadows experienced carers until* a date. Until then
  auto-fill only puts them in the shadow place, next to an experienced (non-trainee, non-agency) carer, keeping them
  on the same run where it can; after the date they work normally. (Also a column in the Excel template.)
- **Fairness report** (Reports page) – for the last 4, 8, 13 or 26 weeks: days worked against days due, days short,
  overtime, weekends worked, most weekends in a row, sick days, annual leave and shadow days for each carer, with
  anything out of line in amber. Can be downloaded as Excel.
- **Finalise week** – once a week is done, **✔ Finalise week** switches off Auto-fill, Fill gaps only,
  clearing and editing for it, so it can't be changed by accident (the weekend and days-in-a-row rules rely
  on past weeks being right). Sickness cover still works on a finalised week. **Reopen week** undoes it.
- **Half days** – the **½** button on any place on the Schedule splits it into two parts, each with its own carer and
  its own start and finish times (24-hour, e.g. 07:00–14:00 and 14:00–21:00 – type 730 for 07:30). The times start
  from the run's *Half-day times* on the Runs page and can be changed on each split. Split places are by hand only:
  auto-fill never creates or changes them. A half day counts as **half a day** towards days per week, and as a day
  worked for the days-in-a-row and weekend rules. Rules are checked by time: a driver must be on for each part, a
  carer can do a morning on one run and an afternoon on another (overlapping times are flagged as double booked), and
  "can't work with", gender and leave are checked for whoever is on at the same time. Printouts, PDFs, the carer view
  and change notices show the times. *Make whole day* undoes a split.
- **Day-off requests** – add one as a leave type ("Day-off request") on the Leave page or the carer's page. Unlike
  leave it isn't a hard block: auto-fill avoids the day wherever cover allows, and if it can't, the day is flagged
  amber ("asked for Wed off") and the auto-fill report says how many requests couldn't be met.
- **Regular patterns** – on a carer's page, *Usually works* ticks the days they normally work, every week or every
  other week (e.g. every other weekend). Auto-fill puts them on those days first; the safety rules still come first.
- **What changed since shared** – sharing a PDF or printing a carer rota remembers what was sent. If the week then
  changes, the Schedule says so ("2 changes for 2 carers"), lists each change, and *Share update* makes a PDF for just
  the carers affected, with the changed days marked.
- **Swap shifts** – *⇄ Swap*: pick a carer and one of their shifts, and who they're swapping with (the same day to swap
  runs, another of their shifts to swap days, or nothing if they're just taking it). Every rule is checked for both
  before anything changes; works on finalised weeks too.
- **Find a carer** – type a name in *🔍 Find carer* to highlight all their shifts and see their next 4–8 weeks
  (also by clicking a name in the carer summary).
- **Share** – the **Share ▾** button on the Schedule has everything for getting the rota out:
  - **PDF for carers:** a designed **team rota** (landscape: colour-coded runs, who each carer is working with, an
    *Open shifts* box so staff can offer to pick them up) or **one page per carer** (their week day by day). Both
    show your organisation name (set it in *Settings & Data*) and the date published. Days not working always show
    as "Day off", so nobody's sickness or leave is shared with the team. In the desktop app the PDF is saved
    straight away, ready to email or WhatsApp; in a browser the print window opens – choose *Save as PDF*.
  - **Print:** the run rota, a carer rota for the wall, or a sheet for each carer (with full detail, for the office).
  - **Export CSV** for spreadsheets.
  Unfilled places show as **[OPEN]**.
- **Undo** – the **↶ Undo** button (top right) or Ctrl+Z / ⌘Z steps back through the last 30 changes,
  including auto-fills and imports.
- **Import carers from Excel** – on the Carers page, **Download Excel template** gives a sheet with the right
  columns and a "How to fill in" tab. Fill it in, then **Import from Excel** (Excel .xlsx or CSV). You see what
  will be added or changed, and any rows that can't be read (with the reason), before anything is imported.
  A row with an existing carer's name updates that carer; blank cells keep their current values.
  **Download carers (Excel)** gives your current carers in the same layout, to edit in Excel and import back.
- **Fill gaps only** – next to Auto-fill week. Fills just the empty slots using the same rules, without
  moving anyone already on the schedule (Auto-fill week reshuffles every slot that isn't locked).
- **Sickness cover** – **🤒 Report sickness** on the Schedule marks a carer off sick for the dates given and
  takes them off every shift in that time. For each emptied shift it lists who can cover it without breaking
  any rule, best first (regular staff short of their days, then working the day before/after or on their
  preferred run; overtime and agency last), with a "why others can't" list. Click a name to fill it. Any empty
  shift also has a **Find cover** link.
- **Manual overrides** – you can still pick someone on leave, sick or unavailable; you are asked to confirm
  and the cell is flagged as an override.

## Auto-fill rules

Saturday and Sunday are planned first (they are the hardest days to cover), then Monday to Friday.
Each day:

1. **Pass 1** (contracted days only)
   0. Runs limited to named carers are filled first. Their carers are kept for those runs.
   1. Every double-up gets a driver.
   2. The second carer on each double-up is a non-driver (drivers are kept free for driver slots).
   3. Every single run gets a driver.
2. **Pass 2** (the "Double pass" tick box): fills remaining gaps with anyone still free that day,
   including spare drivers and the spare weekdays of named-run carers, and optionally carers who have
   agreed a +1 overtime day.

Always enforced: no-one is booked twice in one day, no-one goes over their days per week, gender rules,
double-ups-only / singles-only carers, carers who can't work together,
named-carer runs, leave / sickness / availability.

### Looking back over the past 3 months

Auto-fill reads the previous 13 weeks of schedules saved in the app (fill weeks in date order):

- **Weekends off** – aims for a full weekend (Sat + Sun) off every 2 weeks: anyone who worked last
  weekend is steered away from this one. Anyone who has worked 2 weekends in a row is automatically flagged
  **⚑ Weekend off priority** and kept off the next one, so nobody goes past 3 weeks – putting them on by
  hand is flagged red. The flag comes only from what people have actually worked, so nobody is favoured
  by hand. People working a weekend
  are given both days where possible, so others get whole weekends off.
- **Preferred runs** – carers are put on their preferred runs first, ahead of the run-pair rotation below,
  and a final step swaps same-day shifts to move them onto them. A carer set to **Only these runs** is never
  put on any other run (doing it by hand asks for confirmation and is flagged).
- **Same 2 runs for 3 weeks** – carers are kept on their current pair of runs (e.g. Mon–Wed on Run 2, a day
  off, then Fri–Sat on Run 4) for 3 weeks, then moved to a different pair. Within a week it avoids a 3rd
  different run and keeps runs in blocks of days.
- **No more than 5 days in a row** – counts the days worked at the end of last week (and the start of next
  week, if it is already scheduled). Auto-fill never goes over it; if that would leave a gap, it swaps one of
  a carer's other shifts to someone else so they can cover it. Going over by hand is flagged red. The limit
  can be changed in Settings (0 = no limit).
- **2 days off after 6+ in a row** – if a carer ends up working 6 or 7 days in a row for any reason (added by
  hand, or the limit above raised), auto-fill keeps the next 2 days off for them, including into next week.
  Putting them back on sooner is flagged red.
- **No more days off than the profile allows** – each carer should work their days per week, less any days
  marked unavailable, on leave or sick. Overtime days are only used when no one else can cover the shift; a
  final step hands overtime shifts back to anyone still short, and shifts are swapped around so a carer who
  is short can take over from someone who can cover a gap instead. Anyone still short is shown as a warning
  ("4 days off – profile allows 2"), and the auto-fill report says whether that is because there are more
  contracted days than shifts that week.
- **Weekends are staggered** – only as many people who worked last weekend work this one as still leaves
  enough people for next weekend, so the weekend-off rule never empties a whole weekend at once.
- **Days off together** – avoids leaving a single day off sandwiched between working days.
- **Random, not alphabetical** – runs and carers are shuffled each time, so pressing Auto-fill again gives
  a different version.

When several carers could fill a slot, it first takes anyone who must work every remaining available day to
meet their contract, then keeps drivers out of non-driver slots, then weighs up: how far behind on contracted
days they are, **males first** (changeable in Settings), the weekend, run-pair and days-off preferences above,
and a random shuffle (see `WEIGHTS` in the engine).

## Tests

```
node tests/engine.test.js          # the auto-fill rules
cd supabase/test && npm ci && npm test   # the shared-storage rules (runs setup.sql in a test database)
node apps-script/test/code.test.js     # the Google Drive version's one-person-at-a-time rules
```
