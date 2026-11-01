# Install Saathi on a Windows computer

This guide is for the person in the family who looks after the computer. It takes about ten minutes. You do not need to know anything about programming.

You need: a Windows 10 or 11 computer that stays on at home (an old laptop is fine), the internet, and a pen and paper.

## 1. Download

1. Open **https://github.com/akshatinnovate-png/Saathi-Alexa/releases** and click the newest release.
2. Under **Assets**, click **Saathi-Setup-…exe** to download it.

## 2. Install

1. Double-click the file you downloaded.
2. Windows may show a blue box saying **"Windows protected your PC"**. This appears for new programs that are not yet widely known. Click **More info**, check it says **Saathi-Setup**, then click **Run anyway**.
3. Click **Next** through the screens. Leave both boxes ticked:
   - **Put a Saathi icon on the desktop**
   - **Start Saathi when I sign in to Windows**, so reminders and calls for help keep working after a restart
4. Click **Install**, then **Finish**. You do not need to be an administrator.

## 3. Write down the recovery key (once, important)

The first time Saathi opens, a black window asks whether to lock Saathi's key into this computer.

1. Type `yes` and press Enter.
2. A **recovery key** appears, in groups like `ABCDE-FGHIJ-…`. **Write it on paper.** Keep the paper somewhere safe and away from the computer, for example with your important documents.
3. To check you wrote it down, the window asks for the last group. Type it and press Enter.

Without this key, if the computer breaks, nobody can open the family's data, not even you. Saathi shows it only this once.

If you skip this step, you can do it later from the Start menu: **Saathi → Lock the key into this computer**.

## 4. Set up the family

Your browser opens Saathi by itself. Create your account, add Aaji's details and invite the family. The app walks you through it.

From now on, open Saathi with the **Saathi** icon on the desktop.

## 5. Reach Saathi from anywhere (optional)

At first Saathi works only on this computer. To use it from phones, from another house, or with Alexa+, give it a private https address. This is free.

1. Install **Tailscale** from **https://tailscale.com/download** and sign in (Google, Microsoft or GitHub).
2. From the Start menu, open **Saathi → Reach Saathi from anywhere** and choose **1**.
3. If Tailscale prints a link to turn on **Funnel**, open it and allow it.
4. When it says **Done**, open **Saathi → Stop Saathi**, then open **Saathi** again.
5. Sign in at the new address once with your password and add your passkey again (passkeys belong to one address). Pair Aaji's tablet and Alexa+ with the new address.

Only signed-in family members and approved devices can use that address. To go back to this computer only, run **Reach Saathi from anywhere** again and choose **3**.

## Everyday things

| I want to… | Do this |
|---|---|
| Open Saathi | Double-click **Saathi** on the desktop |
| Stop Saathi | Start menu → **Saathi → Stop Saathi** |
| See where the key is kept | Start menu → **Saathi → Where is my key?** |
| Move Saathi to a new computer | Copy the folder **Saathi data folder** (in the Start menu) to the new computer at the same place, install Saathi there, then run **Restore the key from a recovery key** and type the key from your paper |
| Update Saathi | Download the newer **Saathi-Setup** and run it. Your data stays |
| Remove Saathi | Settings → Apps → Saathi → Uninstall. The family's data stays in the data folder until you delete it yourself |

## If something goes wrong

- **Saathi does not open:** a notepad window opens with Saathi's log. The last lines say why. Send them to whoever helps you with Saathi.
- **"The Saathi key broker could not open the key":** the computer's security chip was reset or the computer was changed. Use **Restore the key from a recovery key** with your paper.
- **The browser says the page cannot be reached:** open Saathi from the desktop icon; it starts Saathi if it is not running.

## For the careful: check the download is genuine

Each installer is built by GitHub from this repository's public code and carries a signed record of how it was built. With the GitHub command line installed:

```
gh attestation verify Saathi-Setup-1.1.0.exe --repo akshatinnovate-png/Saathi-Alexa
```

The release also lists the file's SHA-256 in `SHA256SUMS-windows`. In PowerShell, `Get-FileHash Saathi-Setup-1.1.0.exe` must show the same value.

## What gets installed where

| What | Where |
|---|---|
| The program, its own copy of Node.js (checked against a pinned SHA-256) and the key broker | `%LOCALAPPDATA%\Programs\Saathi` |
| The family's encrypted data, the key (until locked into the chip), settings and logs | `%LOCALAPPDATA%\Saathi` |
| Start with Windows | One entry under your user's `Run` key, only if you ticked the box |

Nothing is installed for other Windows users, and nothing needs administrator rights.
