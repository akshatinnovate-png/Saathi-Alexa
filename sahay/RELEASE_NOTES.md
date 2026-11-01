**Sahay** (सहाय, "help") is a live voice partner that sees and drives your Windows PC. A byproduct of [Saathi](https://github.com/akshatinnovate-png/Saathi-Alexa).

### Get started
1. Download **Sahay-1.0.0.exe** below and run it. (Windows may say "Windows protected your PC": click More info, then Run anyway.)
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
- Verify the download: `gh attestation verify Sahay-1.0.0.exe --repo akshatinnovate-png/Saathi-Alexa`
