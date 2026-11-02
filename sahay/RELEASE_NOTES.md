**Sahay** (सहाय, "help") drives your Windows PC for you. You type what you want; it moves its own cursor, clicks and types until the job is done. A byproduct of [Saathi](https://github.com/akshatinnovate-png/Saathi-Alexa).

### New in 2.0.1: fixes "Can't reach Groq"
- Sahay now talks to Groq through Windows' own web stack (WinHTTP), so it follows your system proxy and network settings, and falls back to a direct IPv4 connection if that fails.
- When Groq answers with an error, the chat shows Groq's real message instead of retrying silently.
- If a request is too big for Groq's free limit, Sahay trims older history and the screen description and tries again.

### New in 2.0.0: rebuilt from scratch
- **Its own cursor.** A coloured Sahay pointer glides to each target, then the real mouse moves and clicks there, with a ripple on every click, so you see exactly what it does.
- **A local screen reader, no cloud vision.** The *Mover* reads the screen on your PC: Windows UI Automation lists every button, link and box in the window, and Windows' built-in text recognition (OCR) reads all the text on screen. Each thing gets a number (E for controls, T for text) and its position. It runs offline, has no rate limit and answers in about a second.
- **One brain: Groq `gpt-oss-120b`.** Groq only writes replies and gives the Mover its instructions ("click E4", "type …", "scroll down"). The Mover does all the seeing, moving and clicking, then reports back what changed.
- **Every reply on screen.** The chat panel shows every reply from Groq, every step the Mover takes (→) and what happened. Type more while it works and it takes your change into account at once.
- **New sphere.** Smoother glow and swirl, colour by state (thinking, acting, waiting, stopped), pause bars when stopped.
- **Doesn't quit on limits.** If Groq's free limit is hit it waits exactly as long as Groq says and carries on; add several keys to switch between them.

### Get started
1. Download **Sahay-2.0.1.exe** below and run it. (Windows may say "Windows protected your PC": click More info, then Run anyway.)
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
