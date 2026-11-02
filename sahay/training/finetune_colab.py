import json
import subprocess
import sys

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "unsloth", "trl", "datasets"], check=True)

from datasets import Dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel

SYSTEM = "You are Sahay, a Windows PC helper. Answer a task with the steps that do it, one per line."

rows = []
with open("knowledge.jsonl", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        if "task" in item and item.get("steps"):
            rows.append({"messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": item["task"]},
                {"role": "assistant", "content": "\n".join(item["steps"])},
            ]})
print(f"{len(rows)} training examples")

model, tokenizer = FastLanguageModel.from_pretrained("unsloth/Qwen3-4B-Instruct-2507", max_seq_length=2048, load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16, lora_dropout=0, target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])

data = Dataset.from_list(rows).map(lambda r: {"text": tokenizer.apply_chat_template(r["messages"], tokenize=False)})
trainer = SFTTrainer(model=model, tokenizer=tokenizer, train_dataset=data, args=SFTConfig(dataset_text_field="text", per_device_train_batch_size=2, gradient_accumulation_steps=4, num_train_epochs=3, learning_rate=2e-4, logging_steps=5, output_dir="out", report_to=[]))
trainer.train()

model.save_pretrained_gguf("sahay_gguf", tokenizer, quantization_method="q4_k_m")
subprocess.run("cp sahay_gguf/*.gguf sahay.gguf", shell=True, check=True)
with open("Modelfile", "w") as f:
    f.write("FROM ./sahay.gguf\nPARAMETER temperature 0.2\n")
print("Done: download sahay.gguf and Modelfile")
