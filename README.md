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
  The carers list shows whether each person is due a weekend off, and flags anyone who has worked 2 weekends
  in a row as **⚑ Weekend off priority**.
- **Runs** – add, remove, rename, reorder. Double-up (2 carers) or single (1 carer); male only, female only,
  or either; untick days a run doesn't operate. Runs need a driver unless "Needs a driver" is unticked.
  **Only these carers** limits a run to named people (e.g. a run covered by 3 non-drivers).
- **Schedule** – Monday to Sunday grid. Pick carers by hand (the slot is then 🔒 locked and auto-fill
  leaves it alone), add a 3rd shadow / training carer, copy the previous week, print, export CSV.
  Problems are highlighted in red (e.g. no driver, double booked, on leave) and amber (overrides, overtime).
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
named-carer runs, leave / sickness / availability.

### Looking back over the past 3 months

Auto-fill reads the previous 13 weeks of schedules saved in the app (fill weeks in date order):

- **Weekends off** – aims for a full weekend (Sat + Sun) off every 2 weeks: anyone who worked last
  weekend is steered away from this one. Anyone who has worked 2 weekends in a row is automatically flagged
  **⚑ Weekend off priority** and kept off the next one, so nobody goes past 3 weeks – putting them on by
  hand is flagged red. The flag comes only from what people have actually worked, so nobody is favoured
  by hand. People working a weekend
  are given both days where possible, so others get whole weekends off.
- **Same 2 runs for 3 weeks** – carers are kept on their current pair of runs (e.g. Mon–Wed on Run 2, a day
  off, then Fri–Sat on Run 4) for 3 weeks, then moved to a different pair. Within a week it avoids a 3rd
  different run and keeps runs in blocks of days.
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
