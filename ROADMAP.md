# Roadmap

What Saathi plans to do next, roughly in order. Plans change; the [CHANGELOG](CHANGELOG.md) records what actually shipped.

## Next release (1.4)

- Find a second maintainer and turn on required reviews for `main` (see [GOVERNANCE.md](GOVERNANCE.md)).
- Signed git tags for every release, in addition to the signed release files.
- Keep test coverage at or above 90% of lines and 80% of branches (CI enforces this).
- More languages for the elder's voice and screen, starting with Tamil and Bengali.

## Landmark features (committed)

Built in this order. Every feature that keeps an elder safe is free in every plan.

### 1. An assistant that does things, not just answers

- **Landing page:** answers questions about Saathi in place (what it does, privacy, plans, setup), grounded only in Saathi's own documents and linking to them. Visitors can talk to the demo family's Saathi live, and set up a home by describing their parent in a conversation that fills in the onboarding form for them to check.
- **Family app:** adds and edits medicines, records refills, books and escorts doctor visits, sends the elder translated messages, invites members, acknowledges alerts, updates where things are kept and changes privacy settings. Every change is shown on a confirmation card first and needs a tap; every action is checked by the Rust policy and written to the audit log. Several changes in one sentence become one card. A short morning briefing when the app opens.
- **Without a paid AI key:** much better offline understanding, plus free providers (Groq's free tier, or Ollama on the family's own computer).

### 2. Scam Guard: Sahay stops a scam, then explains it

When the elder misses a scam, Sahay acts on the Windows PC.

- **Detects:**
  - remote-access apps (AnyDesk, TeamViewer, UltraViewer, QuickSupport, RustDesk) starting during a risky moment
  - payment or OTP pages during a remote session or suspicious call
  - lookalike bank sites and newly registered domains
  - fake tech-support lock screens, gift-card and crypto requests
  - "digital arrest" video calls
  - attempts to make the elder close or uninstall Saathi

  Fixed, tested rules plus an optional local AI model. The screen is read on the computer itself.
- **Acts in three levels:**
  - **Warn:** a calm voice and a card.
  - **Stop:** closes the remote-access app and its connection, ends the screen share or call, closes the payment or OTP page, blocks the submit button, and shows a full-screen Safety Pause.
  - **Hold:** keeps remote access and that payment blocked for 30 minutes or until a family member approves.

  The Safety Pause always offers *Call family*, *Call 1930* (India's cyber fraud helpline), and *"It's really me"*, which asks family to approve and never unlocks instantly.
- **Explains:** an annotated screenshot with the warning signs circled, three plain lines in the elder's language (what happened, why it is a scam, you are safe), and a three-step picture of how that scam works, from a library of common scams in English, Hindi and Marathi. If money may have moved: call the bank, call 1930 within the first hour, report on cybercrime.gov.in. Never shaming.
- **Reports to the family in the background:** an urgent alert with a timeline of what Sahay saw and did, the screenshots, the scam type and next steps. OTPs, passwords, card and account numbers are blacked out on the computer before upload; reports are end-to-end encrypted and deleted after 90 days unless kept. The family app gets a Scam Guard tab with incidents and an *Approve / keep blocked* button.
- **Safe to trust with this power:**
  - **Consent:** the elder and the family both agree at setup.
  - **Only stops, never destroys:** Sahay never deletes files, cancels completed payments or changes passwords.
  - **Safe list:** family-approved payees and sites never trigger it.
  - **Tamper protection:** turning Sahay off needs a family PIN, and attempts alert the family.
  - **Tested in CI:** a library of recorded scam scenarios that must be stopped, and normal banking sessions that must not be.
- **Where it runs:**
  - Windows first.
  - Then Android through accessibility features (direct APK installs; the Play Store needs a separate review).
  - Then phone calls, with Saathi Calls.

### 3. Saathi Insight: notice changes early

A weekly trend and an early-change alert from what Saathi already sees: doses taken and missed, check-in mood, routine, how often the elder asks the date or time, door activity and help requests. It compares the elder only with their own normal, never diagnoses or uses medical wording, respects private check-ins, and can be turned off. It also produces a one-page doctor report (PDF) for appointments.

### 4. Family Voice and Living Legacy

- **Family Voice:** family members record short clips, and reminders play them in their real voice. This uses recordings only, never voice cloning.
- **Living Legacy:** the memory book becomes an illustrated, narrated family book in the elder's own voice and every family language, exportable as a PDF or audiobook.

### 5. Scam Shield Network

When any Saathi spots a new kind of scam, it shares only the anonymised pattern (keywords, language, region; never names, numbers or conversations). After a human checks it, every Saathi warns its elder ahead of time, and the family app shows "scams near you". Opt-in per household, and free in every plan.

### 6. Plans and payments for hosted Saathi

The open source version stays free forever and has no payment code. The hosted version is paid for by the family or organisation, never the elder.

| Plan | Indicative price | Includes |
|---|---|---|
| Saathi Free (hosted) | ₹0, one elder | Family app, elder screen, Alexa+ and MCP, all safety features |
| Family | ₹299/month or ₹2,999/year | Saathi Calls, WhatsApp summaries, Insight, doctor reports, Family Voice |
| Family Plus | ₹599/month | Two elders, two calls a day, unlimited family members |
| Care Agency | ₹149 per elder per month | Agency Console for many households, carer roles, data processing agreement, support |
| Clinic | from ₹2,999/month | Patients' between-visit trends and reports, with consent |
| Gift a Saathi | Sponsored | NGOs, companies' CSR funds and donors pay for elders who cannot |

**Eldercare rules for billing:**
- The elder never sees a price, an upsell or a payment screen.
- Safety (help escalation, scam protection, medicine reminders) is never behind a paywall.
- No pop-ups, banners, badges or countdowns. Plans live only in Settings → Plan, for whoever pays.
- If a payment fails, safety keeps working, only paid extras pause, and the payer gets one quiet email.
- Plain prices, cancel in two clicks, a reminder before a yearly renewal, and the family's data downloadable at any time.

Payments go through Razorpay in India (UPI AutoPay, cards) and Stripe abroad.

### 7. Saathi Calls

Saathi phones the elder every day on any phone (mobile or landline), in their language: tablets, how they feel, family messages, and help if needed. Unanswered calls alert the family, and the family gets a WhatsApp summary. Elders can forward a suspicious SMS or WhatsApp to Saathi's number to check it.

## Within a year

- An independent security review of the vault, the key broker and sign-in, published in `docs/`.
- A packaged Linux build of the key broker alongside Windows and Android.
- Offline-first family app: read and reply to messages without a connection, sync later.
- Accessibility review with real elder users and their carers.

## Not planned

- Selling or sharing anyone's data, advertising, or tracking. Saathi will not do these.
- Ads, upsells or payment prompts on the elder's screen, voice or calls.
- Cloud-only features that stop a family running Saathi on their own computer.
- Voice cloning of family members.
