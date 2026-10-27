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
leave / sickness / availability. Male-only and female-only runs are filled before mixed runs. When several
carers could fill a slot it prefers: carers who must work every remaining available day to meet their
contract → non-drivers for non-driver slots → **males first** (changeable in Settings) → carers furthest
behind on their contracted days.

## Tests

```
node tests/engine.test.js
```
