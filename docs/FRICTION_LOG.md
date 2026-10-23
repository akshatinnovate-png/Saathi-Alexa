# Friction log

Entries recorded while building Saathi. Severity: Low / Medium / High / Blocker.
[Add your own entries from setting up Alexa+ Preview and deploying, and edit these to match your experience.]

## 1. Sentiment analysis for Marathi
- **Task:** Detect mood from an elder's check-in spoken in Marathi.
- **Steps:** Called Amazon Comprehend `DetectSentiment` with `LanguageCode: "mr"`.
- **Expected:** Sentiment for a major Indian language (about 83M speakers).
- **Actual:** DetectSentiment supports a fixed list of languages that includes Hindi but not Marathi, Tamil or Bengali.
- **Severity:** Medium
- **Workaround:** Translate to English with Amazon Translate first, then analyse (`src/aws/language.js`). This adds latency and loses nuance.
- **Suggestion:** Add sentiment for Translate's Indian languages, or let DetectSentiment accept `auto` and translate internally.

## 2. Neural voices for Indian languages
- **Task:** Narrate a Marathi story in Marathi.
- **Steps:** Looked for an Amazon Polly Marathi or Tamil voice.
- **Expected:** At least one neural voice per major Indian language.
- **Actual:** Hindi and Indian English (Kajal) only. Marathi is read with the Hindi voice; Tamil falls back to the browser.
- **Severity:** Medium
- **Workaround:** Language-to-voice mapping with fallbacks (`src/domain/languages.js`).
- **Suggestion:** Add Marathi, Tamil, Bengali and Telugu neural voices. Elders who only speak these languages are among those voice assistants could help most.

## 3. Streamable HTTP MCP on AWS Lambda
- **Task:** Host the MCP server serverlessly behind API Gateway.
- **Steps:** Tried the Node `StreamableHTTPServerTransport`, which expects Node `req`/`res` objects and long-lived sessions.
- **Expected:** A documented Lambda pattern.
- **Actual:** Had to use the Web-standard transport in stateless, JSON-response mode and hand-convert API Gateway v2 events to `Request` objects (`src/lambda/mcp.js`). Server-to-client SSE notifications aren't possible this way.
- **Severity:** Low
- **Workaround:** Stateless mode. All state is in DynamoDB.
- **Suggestion:** An official Lambda adapter or a reference CDK construct for MCP servers, ideally with Lambda response streaming for SSE.

## 4. [Alexa+ Preview onboarding]
- **Task:** [Register the MCP endpoint with Alexa+]
- **Steps / Expected / Actual / Severity / Workaround / Suggestion:** [fill in]
