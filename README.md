# CareSchedule

An offline weekly scheduler for domiciliary care runs. It works on **Windows and Mac** with **no internet**.

## Desktop app (recommended)

The desktop app saves everything to a data file on the computer and keeps daily backups, so nothing is lost
if the browser is cleared.

**Download:** on GitHub, open **Actions → Build desktop app**, click the latest successful run and download
**CareSchedule-Windows** (installer `.exe`) or **CareSchedule-macOS** (`.dmg`) from *Artifacts*.
When a version tag such as `v1.0.0` is pushed, the same files are also attached to a **Release**.

- **Windows:** run `CareSchedule-Setup-….exe`. Windows may show "Windows protected your PC" because the app
  isn't code-signed: click **More info → Run anyway**.
- **Mac:** open the `.dmg` and drag CareSchedule into Applications. The first time, right-click the app and
  choose **Open** (it isn't signed by Apple). If macOS says it is "damaged", run
  `xattr -cr /Applications/CareSchedule.app` in Terminal, then open it again.

**Your data** is saved to `Documents/CareSchedule/careschedule-data.json` after every change. The first
change each day also copies the previous file into `Documents/CareSchedule/backups/`, keeping the last 30 days.
**Settings & Data → Open data folder** shows the folder. If the data file is ever damaged, the app restores
the newest backup automatically and says so.

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
node tests/engine.test.js
```
