# CareSchedule

An offline weekly scheduler for domiciliary care runs. It works on **Windows and Mac** with **no internet**
and nothing to install: it is one file, `CareSchedule.html`, that opens in Edge, Chrome, Firefox or Safari.

## Getting started

1. Copy `CareSchedule.html` to a fixed place on the computer (e.g. Documents) and double-click it.
2. Go to **Settings & Data → Load sample data** to try it out, or add your own carers and runs.
3. On **Schedule**, pick the week and press **Auto-fill week**.

Data is saved automatically in the browser on that computer. Use **Export backup** regularly (and to move
data to another computer), and **Import backup** to restore. Always open the file from the same location
in the same browser, otherwise the browser treats it as a fresh copy.

## Features

- **Carers** – add, edit, remove (or mark inactive). Each has gender, driver / non-driver, days per week,
  an agreed +1 overtime day, which weekdays they can work, and dated annual leave / sickness.
- **Runs** – add, remove, rename, reorder. Double-up (2 carers) or single (1 carer); male only, female only,
  or either; untick days a run doesn't operate. Every run needs at least one driver.
- **Schedule** – Monday to Sunday grid. Pick carers by hand (the slot is then 🔒 locked and auto-fill
  leaves it alone), add a 3rd shadow / training carer, copy the previous week, print, export CSV.
  Problems are highlighted in red (e.g. no driver, double booked, on leave) and amber (overrides, overtime).
- **Manual overrides** – you can still pick someone on leave, sick or unavailable; you are asked to confirm
  and the cell is flagged as an override.

## Auto-fill rules

For each day, Monday → Sunday:

1. **Pass 1** (contracted days only)
   1. Every double-up gets a driver.
   2. The second carer on each double-up is a non-driver (drivers are kept free for driver slots).
   3. Every single run gets a driver.
2. **Pass 2** (the "Double pass" tick box): fills remaining gaps with anyone still free that day,
   including spare drivers, and optionally carers who have agreed a +1 overtime day.

Always enforced: no-one is booked twice in one day, no-one goes over their days per week, gender rules,
leave / sickness / availability. Male-only and female-only runs are filled before mixed runs.

### Looking back over the past month

Auto-fill reads the previous 4 weeks of schedules saved in the app (fill weeks in date order):

- **At least 1 weekend off in every 4 weeks** – anyone who has worked each of the last 3 weekends is kept
  off this Saturday and Sunday (can be turned off in Settings). Putting them on by hand is flagged red.
- **Days off together** – it prefers carers who worked yesterday, and avoids leaving a single day off
  sandwiched between working days (including across the Sunday → Monday change of week).
- **No same run week after week** – carers who have done a run a lot recently, or did it on the same day
  last week, are less likely to get it again.
- **Random** – each auto-fill is shuffled, so pressing it again gives a different version.

When several carers could fill a slot, it first takes anyone who must work every remaining available day to
meet their contract, then keeps drivers out of non-driver slots, then weighs up: how far behind on contracted
days they are, **males first** (changeable in Settings), the days-off and run-variety preferences above, and
a random shuffle. The Carer summary shows each carer's last 4 weeks: days worked, weekends off and most
frequent runs.

## Tests

```
node tests/engine.test.js
```
