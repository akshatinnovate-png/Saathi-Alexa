# Product feedback (draft)

> Pre-filled from the build. Rewrite anything marked [your experience]; judges want your genuine view.

## Alexa+ / MCP (spec 2025-11-25, Streamable HTTP)
- **Used for:** The entire Saathi integration: 12 tools, resources, prompts and server instructions.
- **Worked well:** Tool annotations (`readOnlyHint`, `idempotentHint`) and server `instructions` are a clean way to shape a voice assistant's behaviour for a vulnerable user. Structured content plus a spoken "say" line suits voice well.
- **Needs work:** [your experience with the Alexa+ Preview console / testing on device]. Stateless hosting on Lambda needs a documented pattern.
- **Onboarding:** [your experience]
- **Would build again:** [yes/no and why]

## AWS services
| Service | What we used it for | Worked well | Needs work |
|---|---|---|---|
| Amazon Bedrock | Claude as the simulated Alexa+ brain (tool use) | Same Messages API shape as the Claude API via the Mantle client | [your experience: model access request] |
| Amazon Translate | Messages, stories, check-ins across 8 languages | `auto` source detection handles Marathi/Hindi switching | - |
| Amazon Comprehend | Check-in sentiment | Simple API | No Marathi/Tamil/Bengali sentiment (see friction log) |
| Amazon Polly | Narration and replies (neural, SSML prosody) | Kajal sounds natural in Hindi and Indian English | No Marathi/Tamil voices |
| AWS Step Functions | Care-circle escalation | Direct SNS and DynamoDB integrations, no glue Lambdas | Local testing needs a third-party or home-made interpreter |
| Amazon EventBridge | Domain event bus, archive, Scheduler | Archive gives a replayable audit trail of care events | - |
| Amazon SNS | Family and neighbour notifications | Filter policies keep neighbours out of day-to-day nudges | - |
| Amazon DynamoDB, S3, Lambda, API Gateway, Secrets Manager, CloudWatch, X-Ray | Storage, hosting, auth, observability | CDK L2 constructs made the 42-resource stack about 200 lines | - |
| AWS CDK | All infrastructure | `Template` assertions made infra testable | [your experience] |

## Feature requests
1. **Marathi/Tamil/Bengali Polly neural voices** (important): elders who speak only these languages benefit most from voice-first assistants.
2. **Comprehend sentiment for Indian languages** (important).
3. **Official MCP-on-Lambda construct with response streaming** (nice-to-have).
