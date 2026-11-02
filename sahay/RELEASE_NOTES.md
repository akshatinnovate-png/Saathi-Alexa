**Sahay** (सहाय, "help") drives your Windows PC for you. You type what you want; it moves its own cursor, clicks and types until the job is done. A byproduct of [Saathi](https://github.com/akshatinnovate-png/Saathi-Alexa).

### New in 2.7.2: it learns how to do things
- **A how-to handbook.** Groq now gets short, relevant know-how with each task (only what applies, so tokens stay low): how Amazon and Flipkart search, filter and add to cart (products open in a new tab; confirm "Added to Cart"), how to choose a phone or laptop, YouTube, WhatsApp, Gmail, Google, Wikipedia, Windows settings, files, forms and closing apps safely.
- **Learns from its mistakes.** When a plan fails and Groq finds the fix, it writes a one-line lesson that Sahay keeps and brings back for similar tasks.
- **You can teach it.** "Teach: on Amazon, sort by customer reviews before choosing", "next time use the Amazon search box", "always open links in Edge". These lessons are used from then on.
- **Never closes Windows itself.** Program Manager (the desktop), Windows Input Experience, Click to Do, Start, Search and Sahay are protected. "Close everything" (even spelt "close evrything") closes your apps one by one and nothing else.
- **Honest checks.** A success check must use words that appear only after success; checks that are only symbols (like ₹) are refused, and numbers must match exactly, so "₹30,000 – ₹40,000" is never confused with "₹40,000 – ₹59,000". "Knowledge Boat" matches "KnowledgeBoat".
- **Knows the address bar from the site's search box.** Browser controls are marked as such for Groq.
- **Unknown names still open.** "Open knowedgle boat" looks it up on the web and opens the top result; "open browser <link>" uses your default browser.
- **No raw JSON replies.** If a model writes its plan as text, Sahay recognises it and carries it out.

### New in 2.7.1: fixes from real use
- **Clicks the page, not the browser.** Words are matched inside the web page first; tab titles, the address bar and the toolbar only count when you mention them. This stops "click Selina" hitting the tab title and "wait for Sphinx cat" being fooled by the search box.
- **No blind clicking.** Groq may no longer guess screen positions, and plays or pauses video only through the media controls.
- **Full screen done right.** "Full screen it" on YouTube makes the video full screen (not the whole browser); "exit full screen" brings it back.
- **Pictures in one go.** "Get me some images" opens Google Images for whatever you're looking at (it reads the current page's topic); "show me pictures of sphynx cats" works too, even at the end of a chatty sentence ("wow they're so cute, get me some images").
- **Close tabs by topic.** "Close all tabs related to cats" finds every matching tab (cat, cats, Sphynx cat…) and closes them one by one; "close github" closes that tab.
- **Fewer "models busy" pauses.** Sahay now uses every chat model your Groq account offers, drops models that can't follow plans for good, and sends a shorter screen after a failed step.
- Switching windows works with partial titles, even when the browser adds "and 3 more pages".

### New in 2.7.0: research, learned skills, far fewer tokens
- **Far fewer Groq tokens.** Instant commands, media control and learned skills use none. When Groq is needed, the rules are less than half their old size, less history is sent, Groq thinks briefly, and plans end with expect "…" so the Mover confirms success itself instead of a second Groq call. A typical Groq task now costs roughly 1,000–2,000 tokens instead of 5,000–8,000.
- **Learned skills.** When Groq solves a task cleanly, Sahay keeps the plan. Ask the same thing again and it repeats it locally, with zero tokens. If the page has changed and the old way fails, it forgets that plan and asks Groq afresh.
- **Research and shopping.** Groq can now search the web and read pages directly (research and fetch), so "find me a good laptop under 60,000, compare and advise me" comes back with the best three, prices and reasons, and waits for your pick; then it adds your choice to the cart. "I need lab equipment for a chemistry class" lists what you need, then finds each item on Amazon. It never pays.
- **Play and pause are exact.** "Start the video", "resume", "pause", "next" use Windows' media controls, which know whether something is playing, so play only plays and pause only pauses; no more flip-flopping. Groq is told to use the same.
- **Fewer misclicks.** If two things match a click almost equally and the first does nothing, Sahay clicks the other one.
- **"Install VLC", "install Zoom"** install apps with winget, instantly.

### New in 2.6.0: common sense
- **"Play bella ciao on YouTube" now does what you meant, not just what you said.** Sahay opens the video, then:
  - unmutes the PC and turns the volume up to full if it was off or low;
  - watches the player, clicks "Skip" the moment an ad allows it and waits out ads that can't be skipped;
  - presses play if the video didn't start by itself;
  - tells you what it did ("I skipped 1 ad and turned the volume up to 100%").
- **Groq plans with common sense.** Groq is told to do what any sensible person would on the way: turn the sound on and skip ads for videos and music, close cookie banners, "not now" sign-in prompts and blocking pop-ups, pick the official result rather than an ad, and check that a message or file really went through. It still never pays, deletes or shares personal data without asking.
- **Exact volume control.** "Set volume to 30", "full volume", "mute" and "unmute" now set Windows' volume directly instead of pressing keys. Plans can use volume, mute, unmute, sound on and skip ads as steps.

### New in 2.5.0: routines, chains, hotkeys and more instant skills
- **Routines.** "Every day at 9 am play bhajans", "every morning tell me the weather", "at 6:30 pm remind me to walk". Sahay runs them by itself at that time, every day or once. "Show my routines" lists them; "clear routines" removes them. Reminders beep and are spoken.
- **Several things in one sentence.** "Open notepad and type hello", "volume to 30 and play Kishore Kumar songs": each part runs instantly, in order, with no Groq call. If one part needs thinking, Groq finishes the rest.
- **Hotkeys.** Ctrl+Alt+S opens Sahay from anywhere; Ctrl+Alt+M opens it listening.
- **Start with Windows**, from the sphere's menu.
- **More instant skills:** today's news headlines ("today's news"), live currency rates ("100 dollars in rupees", "50 euro in inr"), and a file finder ("find my resume", "open my tax pdf") that searches Desktop, Documents, Downloads, Pictures and OneDrive and opens the newest match.

### New in 2.4.0: it sees, remembers and understands
- **Sees pictures, not just text.** Icons, logos and images without words ("the bell icon at the top right", "the cart icon", a profile picture) are found by Groq's free vision model (Llama 4 Scout) from a picture of the screen, then clicked. Whenever text matching fails, the picture is checked too.
- **Memory.** "Remember that my son Ravi lives in Pune", "remember I use Edge". Facts are kept on this PC and used in every task, and Sahay saves useful facts it learns on its own. "What do you remember" lists them; "forget everything" clears them.
- **Reads the screen for you.** "Read this page", "what's on my screen", "summarise the page" answer from everything readable, out loud.
- **Works on selected text.** Select text anywhere, then "explain this", "translate this to Hindi", "summarise this", "proofread this" or "reply to this".
- **Knows your open windows**, so it can switch straight to the right one.

### New in 2.3.0: more power, almost no pauses
- **Keeps going instead of pausing.** Groq limits each free model separately, so Sahay now uses gpt-oss-120b first and, when its minute budget is spent, carries on with Groq's other free tool-using models (gpt-oss-20b, Llama 4 Scout, Llama 3.3 70B, Kimi K2, Qwen3, Llama 4 Maverick). It checks which ones your account has, skips retired ones, and only waits if every model is busy at once. Together that is roughly ten times the per-minute budget, so a pause should only come after a long burst of work.
- **Finishes the job.** After every plan it reads the screen and checks the task is really done; if not, it works out why (popup, sign-in, wrong page, still loading) and sends a fix, for up to four rounds.
- **Troubleshoots by itself.** If something it needs isn't visible, the Mover scrolls and looks again before giving up.
- **Does more, asks less.** It picks sensible defaults and only stops to ask before paying, deleting files or messaging someone you didn't name. It installs apps with winget and handles files and settings with PowerShell. Replies are one short sentence.

### New in 2.2.1: fewer mistakes
- **Checks before saying done.** After Groq's plan runs, Sahay reads the screen again and has Groq confirm the task really finished; if not, it carries on with only the missing steps.
- **Clicks the right thing.** Words must really match: a single letter like a size "M" only matches "M", part of a word never matches, and filler words like "the" or "button" don't count. If nothing matches well, it waits and looks again instead of clicking a guess.
- **Hands over instead of guessing.** "type my name in the search box", "write a letter to my son" and opinion questions like "what is a good laptop under 50000" now go to Groq instead of being taken literally.

### New in 2.2.0: it talks, and does far more on its own
- **Speaks its answers** in Windows' own voice (turn it off from the sphere's menu: Speak replies aloud).
- **🎤 Talk button** in the chat starts Windows voice typing, so you can speak instead of type.
- **More instant skills, no Groq needed:**
  - Sums: "what is 23 x 45", "15% of 2000", "10 divided by 4".
  - Weather: "weather in Pune" (from wttr.in).
  - Facts: "who is APJ Abdul Kalam", "tell me about the Taj Mahal" (from Wikipedia).
  - Timers and reminders: "set a timer for 5 minutes", "remind me in 10 minutes to take my tablets". It beeps and says it out loud.
  - WhatsApp: "send Good morning to Ravi on WhatsApp" is done step by step on WhatsApp Web (log in once first).
  - Email: "email asha@example.com saying I reached safely" opens a ready Gmail draft for you to check and send.
  - PC: "dark mode", "light mode", "lock the PC", "set volume to 30", "battery", "take a screenshot", "open downloads", "type …".
- **Plain questions** ("why is the sky blue?") go to Groq without a screen description, so they are quick and light.

### New in 2.1.0: instant commands, smarter plans
- **Everyday requests need no Groq at all**, so they are instant and can never hit a limit: play a song or video ("play bella ciao", "open youtube in edge and play bella ciao"), open sites and apps ("open gmail in chrome", "open notepad", "go to irctc.co.in"), search ("search blue shirts on amazon", "google weather in pune"), close a tab or app ("close github", "close tab"), media and volume ("pause", "next song", "volume up", "mute"), and back, refresh, new tab, scroll, zoom, full screen, minimise, the time and date.
- **Play goes straight to the video.** Sahay finds the first real result for your search itself and opens it, so there is nothing to click and no ad to land on.
- **Smaller Groq calls.** Groq's first look at the screen lists only the clickable controls and a little text, and pacing uses Groq's real token counts instead of a cautious guess, so it waits far less.
- **Smarter plans.** Groq gets worked examples (WhatsApp messages, Gmail drafts, shopping, Windows settings) and is told to use direct links and settings pages to skip clicks.

### New in 2.0.2: one Groq call per task
- **Plans, not single steps.** Groq now sees your screen once and answers with the whole plan in one go, for example `open msedge https://www.youtube.com/results?search_query=bella+ciao` then `click "Bella Ciao"`. The Mover carries out every step on your PC by itself. When a step names words that only appear after a page loads, the Mover rereads the screen locally and waits for them, with no further Groq calls. Groq is asked again only if a step fails.
- **No more rate-limit stalls.** Each request is much smaller: one tool, short rules, and only the newest screen; old screens and old steps are no longer re-sent. Sahay also counts what it sends and waits just before Groq's per-minute limit instead of running into it. If Groq's daily free allowance runs out, the chat says when it refills.
- **Opens in the browser you name** ("open youtube in microsoft edge" uses Edge).
- **Window close buttons are not offered for clicking.** Tabs close with ctrl+w and windows with alt+f4, only when you ask. This is what closed Edge before.
- Text typed into a search box is no longer mistaken for a result to click.

### New in 2.0.1: fixes
- **Reaching Groq.** Sahay now talks to Groq through Windows' own web stack (WinHTTP), so it follows your system proxy and network settings, with a direct IPv4-first connection as a fallback. If it still can't connect, the chat says exactly why (no internet, DNS, firewall or antivirus, wrong PC clock, proxy).
- **Works on your app, not on itself.** Sahay used to read and type into its own chat window. It now always works on the window you were using, brings that window forward before typing or pressing keys, and clicks pass through the sphere and the chat when they sit on top of the target. The chat, sphere and cursor are hidden from its screen reading.
- **One step at a time.** Groq gives one instruction per answer, so numbers on screen never go stale between steps, and a missing number is never swapped for a different element.
- **Groq's limits.** Wait times like "1m2.5s" or "250ms" are read correctly. When it waits, the chat says so. Requests too big for the free tier are trimmed and retried. An empty or cut-off answer is retried instead of silently stopping.
- Pasted keys with quotes, "Bearer" or line breaks are cleaned up, and a wrong paste on first run asks again instead of closing.
- Text recognition falls back to English if your Windows language has no OCR pack. "notepad.exe" and other file names are no longer opened as websites. "ctrl++" works.
- New Windows tests in CI check that Groq answers through both connection paths and that Windows OCR reads and places text.

### New in 2.0.0: rebuilt from scratch
- **Its own cursor.** A coloured Sahay pointer glides to each target, then the real mouse moves and clicks there, with a ripple on every click, so you see exactly what it does.
- **A local screen reader, no cloud vision.** The *Mover* reads the screen on your PC: Windows UI Automation lists every button, link and box in the window, and Windows' built-in text recognition (OCR) reads all the text on screen. Each thing gets a number (E for controls, T for text) and its position. It runs offline, has no rate limit and answers in about a second.
- **One brain: Groq `gpt-oss-120b`.** Groq only writes replies and gives the Mover its instructions ("click E4", "type …", "scroll down"). The Mover does all the seeing, moving and clicking, then reports back what changed.
- **Every reply on screen.** The chat panel shows every reply from Groq, every step the Mover takes (→) and what happened. Type more while it works and it takes your change into account at once.
- **New sphere.** Smoother glow and swirl, colour by state (thinking, acting, waiting, stopped), pause bars when stopped.
- **Doesn't quit on limits.** If Groq's free limit is hit it waits exactly as long as Groq says and carries on; add several keys to switch between them.

### Get started
1. Download **Sahay-2.7.2.exe** below and run it. (Windows may say "Windows protected your PC": click More info, then Run anyway.)
2. Groq's free key page opens (console.groq.com/keys). Sign in, click **Create API Key**, copy it and paste it into Sahay. Older Gemini keys are no longer used.
3. The chat opens. Type what you want done, for example "play Bella Ciao on YouTube".

### The sphere
- **Click** it to open the chat, or to stop while it is working. **Drag** it anywhere. **×** (on hover) to close.
- **Right-click** for: open the chat, stop, Groq keys, get a free Groq key, your name, extra instructions, restart as administrator (to control admin windows), the log.
- Log of every step: `%LOCALAPPDATA%\Saathi\logs\sahay.log`.

### New in 1.2.1
- Sahay remembers your Gemini key, so it opens straight to the sphere. It now says so under the sphere when it starts, and if Google ever refuses the saved key, the key window opens by itself. Change keys any time: right-click the sphere, then Gemini keys.

### New in 1.2.0
- **Sahay for Android.** Download **Sahay-Android-1.2.1.apk** below. It is Senku by Steve Aldrin, used with the author's permission, with every charge removed: no plans, no checkout, no usage limits, no account. It runs on Google Gemini with your own free key, stored in the Android Keystore. It floats over your apps, talks with you, and operates the phone through Accessibility.
- **Newer voice model on Windows:** Gemini 3.8 Live is tried first, and the operator follows Google's latest Flash model automatically, so model renames no longer break it. Saved settings from older versions upgrade by themselves.

### New in 1.1.0: it actually gets the job done
- **Two brains.** The voice (Gemini Live) only talks: it answers you at once and hands the job over. A separate operator (Gemini 2.5 Flash) does the work step by step, and is required to take an action every step, so it no longer stops after opening a site.
- **Sharper clicks.** Every step it gets a full, sharp screenshot and a numbered list of every button, link and box, then clicks the right one by number.
- **No more freezing on heavy pages.** Reading the window is capped at 1.2 seconds, even on YouTube.
- **Talk over it.** Changes and answers you give mid-task go straight to the operator ("blue one", "size M", "don't place the order").
- **Detailed log** of every step in `%LOCALAPPDATA%\Saathi\logs\sahay.log`, so any problem can be traced.

### Older: Get started (1.x)
1. Download **Sahay-1.2.1.exe** below and run it. (Windows may say "Windows protected your PC": click More info, then Run anyway.)
2. Google's free key page opens. Sign in, click **Create API key**, copy it and paste it into Sahay.
3. Allow the microphone if Windows asks. Talk.

### What it does
- Talk to it and it does the job: opens any app or website, clicks, types, scrolls, drags, presses shortcuts, runs PowerShell, reads and writes files, uses the clipboard, switches windows.
- It sees the screen live and reads every button and box in the window (Windows UI Automation), so it clicks the right thing by name.
- Talk over it while it works: it stops, listens, acknowledges the change and carries on with the new plan. It asks you when a choice is yours (which item, which size) and waits.
- It does not quit mid-job: it resumes the same conversation after drops, rotates between your Gemini keys and models when one hits its free limit, waits and retries on its own, and feeds failures back so it tries another way.

### The sphere
- **Click** it to stop. **Click again** to start. **Drag** it anywhere. **×** (on hover) to close.
- **Right-click** for: type a request, Gemini keys (add several to avoid limits), your name, extra instructions, restart as administrator (to control admin windows), the log.
- Colours: your colour = listening, purple = speaking, amber = working, orange = waiting for Gemini, grey = stopped, red = needs attention.

### Good to know
- Free: it uses Google's free Gemini tier with your own key. Keys are encrypted with your Windows account and never leave your PC except to Google.
- It has full control of the PC, by design. Stop it any time with one click.
- Data and log: `%LOCALAPPDATA%\Saathi\sahay.json` and `logs\sahay.log`.
- Verify the download: `gh attestation verify Sahay-1.2.1.exe --repo akshatinnovate-png/Saathi-Alexa`
