# Semantic injection classifier (CTL-AI-002)

The model the Gateway runs in process to score prompt injection and jailbreak attempts in Polish and
English: what people type, what agents put in their actions, and what models and tools return. The
shipped artifact is `policies/models/injection-classifier.json` (weights, intent lexicons and the
evaluation below); the Gateway reloads it like any other policy file.

## Model

Logistic regression over hashed features (2^18 buckets, FNV-1a):

- words and word pairs, and character 3-, 4- and 5-grams inside each word, after lowercasing,
  folding Polish and other diacritics, Cyrillic and Greek homoglyphs and full-width forms, and
  dropping invisible characters;
- intent features from multilingual lexicons (`lexicon.py`): override + prior instructions,
  reveal + instructions, send + sensitive data + external destination, execute + remote script,
  approve + self, role-play + no restrictions, concealment.

At inference the Gateway also scores the text with leetspeak mapped back, spaced-out letters
rejoined and base64, hex and percent-encoded segments decoded, and long texts in overlapping
windows; the highest score wins. `featurize.py` is the reference implementation;
`gateway/crates/server/src/semantic.rs` must produce the same scores, which
`scores_match_the_training_script` checks against `parity.json`.

## Data

| Source                                                  | Attack | Benign | Licence   |
| ------------------------------------------------------- | -----: | -----: | --------- |
| Handwritten corpus, Polish and English (`corpus/*.txt`) |    269 |    244 | this repo |
| Templated variations of override and goal phrases       |    740 |    732 | this repo |
| Public datasets, combined (below)                       |   1785 |   3605 |           |

Public datasets: deepset/prompt-injections (Apache-2.0; attacks kept only with an override or
extraction cue, because the set labels plain role-play as injection), Lakera/gandalf_ignore_instructions
(MIT), jackhhao/jailbreak-classification (Apache-2.0), and the initial prompts of
OpenAssistant/oasst1 in English, Polish and German (Apache-2.0) as benign text.

The handwritten corpus carries the most weight (3x) and includes hard negatives an office assistant sees every day
("zignoruj literówki", "forget the previous file, use this version", "how do prompt injections
work?").

## Evaluation

`corpus/holdout.tsv` is 66 handwritten examples (34 attacks, 32 benign; paraphrases, Polish slang,
leetspeak, spaced letters, homoglyphs and base64) that never enter training.

| Threshold | Holdout precision | Holdout recall | Holdout FPR | 5-fold CV precision (handwritten) | CV recall |
| --------: | ----------------: | -------------: | ----------: | --------------------------------: | --------: |
|      0.50 |              0.93 |           0.82 |        0.06 |                              0.91 |      0.76 |
|      0.60 |              0.93 |           0.77 |        0.06 |                              0.93 |      0.69 |
|      0.70 |              0.96 |           0.74 |        0.03 |                              0.97 |      0.55 |
|      0.80 |              1.00 |           0.68 |        0.00 |                              0.98 |      0.46 |
|      0.90 |              1.00 |           0.56 |        0.00 |                              0.99 |      0.32 |

Read these numbers for what they are: a small holdout written by the same people who wrote the
training corpus. The attacks it misses are mostly goal-only requests without an override phrase
("wget ... | sh", "wire the funds to the IBAN below and skip the checks"), which the deterministic
signatures and Cedar policies catch instead. The classifier is one layer: it can ask for a human or
refuse a message, and the deterministic controls hold whether or not it notices anything.

## Retrain

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./fetch_datasets.sh
.venv/bin/python train.py --version 2026.10.05
cargo test --manifest-path ../../gateway/Cargo.toml -p betsee-server semantic
```

`train.py` writes the model and `parity.json`; the Gateway picks up the new model on its next
reload check.
