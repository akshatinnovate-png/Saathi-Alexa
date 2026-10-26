# Reality audit

Everything in Saathi that was a demo, a simulation, a hard-coded assumption or a feature that only looked real, and what was done about each one.

## Data and setup

| # | What was fake or assumed | Why it mattered | Fix |
|---|---|---|---|
| 1 | The local store **reset every household, account and message to the demo family** whenever the data format version changed | A real family would lose everything on upgrade | Stored data is never replaced. Older records are upgraded when read |
| 2 | Every new install was **pre-filled with a fictional family** (Aaji, Riya, Anand, Meera, Dr. Kulkarni) and three demo logins with a public password | Strangers could log in; real users saw people who don't exist | Demo is opt-in (`npm run demo` or `SAATHI_DEMO=true`). A normal start is empty and begins with sign-up |
| 3 | DynamoDB `reset()` wrote the demo family into the production table | Same as above, in AWS | Only allowed in demo mode |
| 4 | `/api/demo/reset`, `/api/demo/sweep` and `/api/ring/simulate` were open in production | Anyone logged in could fake doorbell rings | Only mounted in demo mode |
| 5 | Unauthenticated fallbacks acted as `riya` | Wrong person credited for actions | Falls back to the household owner, never a demo name |

## The person being cared for

| # | What was fake or assumed | Fix |
|---|---|---|
| 6 | Every household lived in **India time** (`Asia/Kolkata`), used for tablets, reminders, the device clock and letters | Each elder has their own time zone, chosen at setup (guessed from the browser) and editable |
| 7 | The emergency number was **always 112 (India)** | Country chosen at setup sets the number (112, 911, 999, 000, 111…), editable |
| 8 | Everyone was **"she/her"** in alerts, letters, summaries and prompts | Pronouns chosen at setup (she, he, they) and used everywhere |
| 9 | Hard-coded names in live text: *"A story from Aaji"*, *"Someone is at Aaji's door"*, *"Meera was asked to come"*, a door message sent as `meera` | Uses the elder's name and the household's actual neighbour |
| 10 | Introductions (*"Kabir is your grandson"*) stayed in English for elders who speak Marathi or Hindi | Translated into the elder's language when someone joins |
| 11 | No way to change the elder's details after setup | Settings for name, language, home, time zone, country, emergency number, pronouns, pharmacy and accessibility |

## Care

| # | What was fake or assumed | Fix |
|---|---|---|
| 12 | Medicines could only be added during setup, never changed | Add, edit and remove medicines in the family app |
| 13 | **One time per day per medicine**, every day | Several times a day, chosen days of the week, supply counts down per dose |
| 14 | Doctor visits **only existed in the demo data**: no way to add one | Add, edit and remove visits; translated for the elder |
| 15 | People could be invited but never removed | The owner can remove someone from the circle |
| 16 | The weekly letter was **never sent when running locally** and on AWS ran at 18:00 India time for everyone | Sent Sunday 18:00 in each elder's own time zone, wherever Saathi runs |
| 17 | Escalation waited **20 seconds** before calling the neighbour (demo pacing) | 5 minutes for family, 5 more for the neighbour by default; demo mode keeps it short |

## Aaji's device

| # | What was fake or assumed | Fix |
|---|---|---|
| 18 | The device page was an **"Alexa+ simulator"** with developer panels (tool traces, fake doorbell buttons, demo reset) | It is Aaji's real Saathi screen. Developer panels only appear with `?dev` or in demo mode |
| 19 | Quick phrases were about **Riya and Satara** | Built from the household's real circle and plain prompts |
| 20 | It only spoke when spoken to | Speaks tablet reminders when they are due, announces messages and plays voice notes as they arrive, reminds about visits |
| 21 | Its clock showed India time | Shows the elder's time zone |

## Integrations

| # | What was fake or assumed | Fix |
|---|---|---|
| 22 | The Ring doorbell was **simulated**, signed with a shared default secret, and every unknown device landed in the demo household | Real Ring accounts connect from the family app (Ring's push events). A private per-household doorbell webhook works with Home Assistant, IFTTT or any smart doorbell |
| 23 | Without a model, translation was a **pass-through** that quietly delivered untranslated text | The family app says clearly when a message could not be translated; setup offers Claude or Amazon Translate |
| 24 | Mood was read by a **small keyword list** even when Claude was available | Claude reads mood when configured (Amazon Comprehend on AWS); the keyword list is only the last resort |
| 25 | The login page showed **X and Apple buttons that did nothing** | Only sign-in options that are really connected are shown |
| 26 | The landing page asked *"How is Aaji today?"* to every visitor | Plain questions about your own family |

## How each fix is checked

`test/reality.test.js` runs a fresh, non-demo install end to end: no fictional family or demo login exists; an old data file survives; a household in Boston gets *"Please call him"* and *"emergency services on 911"* at Boston time; a medicine taken twice a day records the right dose and counts supply per dose; reminders are spoken once and on time; the weekly letter goes out once on Sunday evening Boston time; a removed person loses access; neighbours cannot change medicines; a private doorbell link and a Ring login with its 2-step code both reach the right household. `test/mail.test.js` covers email, invites, Google sign-in and device pairing.

## What is still not real

- **Alexa+ itself.** Saathi is a working MCP server for Alexa+, but connecting a real Alexa+ needs Amazon's Alexa+ MCP integration. Until then, the elder's own Saathi screen (tablet, phone or Echo Show browser) is the real device.
- **Ring** is reached through the community `ring-client-api` library, because Ring has no public API. It was tested against a stand-in for Ring's login and push events, not a live Ring account.
- **The safety screen** for falls, pain and being lost is phrase-based in English, Hindi and Marathi. It errs on the side of alerting; other languages rely on translation first.
