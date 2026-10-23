# Devpost submission (draft)

> Edit anything in [brackets] before submitting.

## Track and challenges

- **Primary track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
- **Mini challenges:** [AWS Builder: 15 AWS services, see below] [Open Source: MIT-licensed, if the repo is public]

## Project name

Saathi: a companion on Alexa+ for elders, and the families who love them

## Tagline

A grandmother who speaks Marathi and is starting to forget. A granddaughter in Toronto who speaks English. Saathi lets Alexa+ be the bridge.

## What it does

Saathi is an Alexa+ integration for older adults living with memory loss, hearing or vision loss, or a language their family no longer shares, and for the care circle around them.

The elder talks to Alexa+ in her own language. Through Saathi's MCP tools, Alexa+ can:
- gently orient her (day, time, place, what's next, who someone is), without ever quizzing her memory;
- help with tablets, described by colour and purpose, and refuse double doses;
- check in on how she feels. Loneliness sends family a gentle nudge. Words like "I fell" start an escalation: family first, then the neighbour, then emergency guidance, until someone taps "I'm on it";
- carry messages across languages: family write in English or Hindi and she hears Marathi;
- keep a memory book of her stories, translated and narrated so grandchildren who can't read her language can hear her voice and her past;
- listen at the front door: a Ring doorbell ring after the neighbour has been sent for closes the emergency, and a morning with no activity earns the family a gentle nudge;
- respect her choices: "keep this between us" keeps ordinary sadness private (never danger), and nothing she says is sent until she confirms.

Family members get the Family Circle app in their own language, and can also ask their own Alexa+ "How is Aaji today?" through the same MCP server.

## How we built it

- **MCP server** in Node.js with the official MCP TypeScript SDK, covering the 2025-11-25 spec: 12 tools with annotations and typed `outputSchema`, resources, a resource template, subscriptions, `list_changed`, prompts with completions, progress notifications, logging, **elicitation** ("shall I send this?"), and **OAuth 2.1 authorization with Amazon Cognito** (RFC 9728 metadata, `saathi/elder` and `saathi/family` scopes). It runs locally (stateful sessions plus SSE) or on **AWS Lambda behind API Gateway** (stateless JSON mode).
- **Ring:** an HMAC-signed, replay-protected doorbell webhook with its own Lambda and a Secrets Manager signing secret. The demo uses a simulated Ring Video Doorbell.
- **Language:** Amazon Translate (auto-detect source), Amazon Comprehend sentiment (Marathi is translated first, since DetectSentiment doesn't support it), and Amazon Polly neural voices with slowed SSML prosody.
- **Care events:** Amazon EventBridge custom bus with a one-year archive. A rule sends `HelpRequested` to an **AWS Step Functions** escalation that uses the SNS and DynamoDB service integrations directly. **Amazon SNS** filter policies keep neighbours out of day-to-day nudges. **EventBridge Scheduler** runs a missed-dose sweep Lambda.
- **State:** Amazon DynamoDB single table and Amazon S3 for narrated stories. **AWS Secrets Manager** holds the MCP token.
- **Observability:** CloudWatch Embedded Metric Format, a CloudWatch dashboard and alarms (an alarm fires if an escalation ever fails), and AWS X-Ray tracing.
- **Simulated Alexa+ device:** a web app that is a real MCP client. **Claude on Amazon Bedrock** chooses tools, with voice in (Web Speech API) and out (Polly).
- **Everything is AWS CDK** (58 resources), with 48 automated tests.
- **Measured safety:** a multilingual eval (English, Hindi, Marathi, romanised) requires 100% emergency recall and zero false alarms in CI. It caught real bugs ("prices have fallen" raised an alarm, a romanised Hindi "chest pain" phrase was missed) that we then fixed.
- **One escalation definition, two runtimes:** the same Amazon States Language JSON is deployed to Step Functions and run offline by a small ASL interpreter we wrote, so the demo works without a cloud account and the tests exercise the real workflow.

## Challenges

[Fill in from the friction log: e.g. Comprehend language coverage, Polly voice coverage for Indian languages, stateless Streamable HTTP on Lambda.]

## Accomplishments

- A voice experience written for someone with dementia: it orients without testing, nudges without alarming, and never speaks an error.
- Multilingual end to end: Marathi in, English out, and back.
- Escalation that is real infrastructure (Step Functions plus SNS) and still runs offline for judges.

## What we learned

[Your words.]

## What's next

Multi-household tenancy, Cognito-authenticated family app accounts, a connection to a real Ring account, clinician-reviewed safety cases, and Marathi and Tamil Polly voices when available.

## Built during the submission window

[If anything existed before the hackathon, say so here. Otherwise: "Everything in this repository was built during the submission window."]
