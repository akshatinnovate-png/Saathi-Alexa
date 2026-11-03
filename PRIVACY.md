# Privacy policy

Saathi looks after an elder's medicines, health, messages and home. This page says what it collects, where that goes, and what it never does. It applies to the Saathi server, its family app and elder screen, its MCP server (including the `saathi-mcp` demo), its Windows installer and its Android app.

## Who is responsible

Saathi is open source software that each family (or a carer or organisation they trust) runs themselves. **Whoever runs a Saathi install controls its data.** The Saathi project does not run a central service and receives no data from any install.

Contact for this policy: akshat.innovate@gmail.com (subject `Saathi privacy`).

## What Saathi stores

Only what the family enters or the elder says to it:

- the elder's profile: name, languages, city, time zone, accessibility needs and emergency number
- the care circle: names, relationships, email addresses and languages of family members and neighbours
- medicines, doses taken, refills, doctor visits
- daily check-ins (how the elder says they feel), memory stories, family messages and alerts
- front-door events and the home map the family builds
- sign-in data: password hashes (scrypt), passkeys, two-step codes, sessions

## Where it is kept and how it is protected

- On the computer or cloud account that runs Saathi, nowhere else.
- Health records are sealed with a key held by the key broker (protected by the TPM or Windows where available). Private family messages are end-to-end encrypted in the browser; the server never sees their keys.
- The `saathi-mcp` demo keeps a fictional family in memory only, refuses every network connection and deletes everything when it stops.

## What leaves the install

Only what the family turns on:

- **Alexa+** (Amazon) receives the answers to what the elder asks it, limited by the privacy settings in the family app.
- **Translation and mood** (Amazon Translate/Comprehend or Anthropic Claude) receive message and check-in text, if the family configures them.
- **Email** (Gmail, Amazon SES or SMTP) carries invites and alerts to family members.
- **Have I Been Pwned** receives the first 5 characters of a password's SHA-1 hash (k-anonymity), never the password.

An egress allowlist blocks connections to any other service.

## What Saathi never does

No advertising, no tracking or analytics sent to the project, no selling or sharing of data, no training of AI models on family data.

## Your choices

The family app lets the family remove members, edit or delete medicines and visits, turn off mood sharing, and choose what Alexa+ may say aloud. Whoever runs the install can copy or delete its data file at any time; deleting the install deletes the data. A person can ask whoever runs their family's install to see, correct or delete their data at any time.

## Changes

Changes to this policy are made in this file, and its history is public in the repository.
