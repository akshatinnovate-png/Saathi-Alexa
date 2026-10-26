# Demo video script (under 3:00)

Judges may stop at 3:00. Lead with the human story, then the proof. Use only your own footage and royalty-free or no music.

**Setup:** start the demo family with `npm run demo`. Two windows side by side. Left: Aaji's Alexa+ simulator (Marathi, Large text, Slower voice on). Right: Family Circle app as Riya (English). Run with Claude (Bedrock or API key) so replies are in Marathi. Reset the demo first.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00-0:20 | Photo-style title card: "Saathi, साथी, companion" | "My grandmother speaks Marathi. Her granddaughter in Toronto speaks English. And Aaji is starting to forget. This is Saathi, on Alexa+." |
| 0:20-0:45 | Aaji: tap **📅 आज कोणता दिवस?** then **👪 Riya कोण?** | "When she's unsure of the day, Alexa+ gently tells her, and never quizzes her. When she forgets who Riya is, Alexa+ reminds her with love." |
| 0:45-1:10 | Aaji: **💛 माझं मन** ("I feel very lonely today"). Riya's app updates with a gentle nudge | "Saathi listens to how she feels. Loneliness doesn't trigger an alarm. It quietly tells Riya: a voice note today would mean a lot." |
| 1:10-1:30 | Riya types "Aaji, I'm calling you tonight ❤️". Aaji taps **💌 निरोप** and hears it in Marathi. Aaji taps **📨 रियाला निरोप**; the big **हो, पाठवा** button appears | "Riya writes in English. Aaji hears it in Marathi. And nothing Aaji says is sent until she says yes." |
| 1:30-1:50 | Aaji tells a story. Memory book card appears in Riya's app in English | "Her stories go into a memory book, translated, so her granddaughter can finally hear her childhood." |
| 1:50-2:25 | Aaji: **🆘 मदत** ("Help, I fell"). The light ring turns red. Riya's app shows the escalation stepper. Let it reach "Neighbour alerted", then press **🔔 Someone rings the bell**. Riya's card turns green: "Help reached her door" | "If she falls, a Step Functions workflow alerts family, then her neighbour. When Meera rings the Ring doorbell, the emergency closes itself, and Aaji hears that help is at the door." |
| 2:25-2:50 | "Under the hood" panel: MCP tool calls, the elicitation, live MCP notifications. Flash the architecture diagram, then the safety eval output (`npm run eval`: 100% recall, 0 false alarms) | "Every answer is an MCP tool call over Streamable HTTP, spec 2025-11-25, with OAuth through Cognito, on Lambda with Translate, Comprehend, Polly, EventBridge, Step Functions, SNS and Bedrock. And the safety screen is measured in three languages." |
| 2:50-3:00 | Title card | "Saathi. No one should grow old alone in a language no one speaks." |
