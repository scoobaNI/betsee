#!/usr/bin/env bash
# Downloads the public datasets train.py mixes into the handwritten corpus. All four are
# redistributable for this use: deepset/prompt-injections (Apache-2.0),
# Lakera/gandalf_ignore_instructions (MIT), jackhhao/jailbreak-classification (Apache-2.0),
# OpenAssistant/oasst1 (Apache-2.0). They are not committed; corpus/public is gitignored.
set -euo pipefail
cd "$(dirname "$0")/corpus"
mkdir -p public/deepset public/gandalf public/jackhhao public/oasst1
hf=https://huggingface.co/datasets
fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
fetch "$hf/deepset/prompt-injections/resolve/main/data/train-00000-of-00001-9564e8b05b4757ab.parquet" public/deepset/train.parquet
fetch "$hf/deepset/prompt-injections/resolve/main/data/test-00000-of-00001-701d16158af87368.parquet" public/deepset/test.parquet
for split in train-00000-of-00001-ded53be747ff55cd validation-00000-of-00001-94481a2a09ff2fff test-00000-of-00001-bc92128b9288a6d1; do
  fetch "$hf/Lakera/gandalf_ignore_instructions/resolve/main/data/$split.parquet" "public/gandalf/$split.parquet"
done
fetch "$hf/jackhhao/jailbreak-classification/resolve/main/default/jailbreak_dataset_full.csv" public/jackhhao/full.csv
fetch "$hf/OpenAssistant/oasst1/resolve/main/data/train-00000-of-00001-b42a775f407cee45.parquet" public/oasst1/train.parquet
echo "datasets in $(pwd)/public"
