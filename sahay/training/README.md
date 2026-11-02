# Teaching Sahay

Sahay learns from a dataset file the moment you give it one. Drop the file onto Sahay's chat, choose **Teach from a dataset…** from the sphere's menu, or type `learn from C:\path\to\file.jsonl`.

Start with [`sahay-starter.jsonl`](sahay-starter.jsonl) (104 tasks, 30 lessons), or the mega set [`sahay-massive.jsonl`](sahay-massive.jsonl) (2,452 tasks including 779 instant templates, and 100 lessons). Both can be loaded; nothing is duplicated. The biggest is [`sahay-50k.jsonl`](sahay-50k.jsonl): 51,026 tasks (779 instant templates plus filled-in examples across shopping, music, messages, travel, study, health, jobs and more) and 100 lessons. `generate_dataset.py` rebuilds them (`python generate_dataset.py sahay-50k.jsonl --mega`).

The new-skills set [`sahay-800k/`](sahay-800k) has 813,074 tasks in 9 uncompressed parts of up to 100,000 lines: food ordering in about 250 cities, jobs by role and city, local services, doctors, movie tickets, restaurants, weather questions, rentals, travel between cities, quick-commerce groceries, phrases in 20 languages, every Bhagavad Gita verse, devotional music, medicines and health conditions, cars, colleges, coding, maths, unit conversions, kids' content, sharing, network checks, books, bill payments, government services and banking. Its 151 templates are in `templates.jsonl`. Teach the whole folder at once with `learn from C:\path\to\sahay-800k`. `generate_new.py` rebuilds it.

## The format

One JSON object per line. There are two kinds of line.

A task, with the steps that do it:

```json
{"task": "send {message} to {name} on whatsapp", "steps": ["open https://web.whatsapp.com", "wait for \"Search\"", "click \"Search\"", "type {name}", "wait 1.5", "click \"{name}\"", "click \"Type a message\"", "type {message}", "key enter"], "say": "Sent \"{message}\" to {name}."}
```

- Words in `{braces}` are filled in from the request: "send good morning to Ravi on WhatsApp" fills `{message}` and `{name}`.
- `{name:url}` puts the value into a web address, with spaces as `+`.
- A task with at least one `{slot}` and two ordinary words runs instantly whenever a request matches it, with no Groq call.
- Every other task is shown to the brain as a worked example for similar requests.

A lesson, which is a rule the brain should follow:

```json
{"lesson": "On Amazon, sort by customer reviews before choosing."}
```

Plain text lines of four or more words are read as lessons too.

## Steps

`open <app | url | browser url>`, `click / double / right / hover <"words" | E# | x,y>`, `type <text>`, `key <keys>`, `scroll down|up <n>`, `drag <a> to <b>`, `wait <seconds>`, `wait for "words"`, `expect "words"`, `focus <title>`, `run <PowerShell>`, `clipboard`, `remember <fact>`, `saathi <tool> <json>`, `media play|pause|next|previous`, `volume <0-100>`, `sound on`, `skip ads`, `research <query>`, `fetch <url>`, `read`.

Lines with steps Sahay doesn't understand are skipped and counted.

## Learning by itself

Every task Sahay finishes cleanly is added to `%LOCALAPPDATA%\Saathi\knowledge.jsonl`, in this same format. Open it from the sphere's menu (**Open my knowledge file**) to read, edit or share what it has learned.

## Training the local brain's weights (optional)

The same file can fine-tune the local model on a free Google Colab GPU:

1. Open https://colab.research.google.com, create a notebook, and choose **Runtime → Change runtime type → T4 GPU**.
2. Upload `knowledge.jsonl` and [`finetune_colab.py`](finetune_colab.py), then run `!python finetune_colab.py`.
3. Download `sahay.gguf` and `Modelfile`, put them in one folder on your PC, open a terminal there and run `ollama create sahay -f Modelfile`.

Sahay uses a model named `sahay` automatically once it exists.
