#!/usr/bin/env python3
"""Generate the CSS token files from docs/design/tokens.json.

Outputs:
  tokens.css         every token as a --bs-* custom property on :root
  tailwind-theme.css Tailwind v4 @theme mapping onto the --bs-* properties

Usage: python3 docs/design/build-tokens.py [--check]
--check exits 1 when an output is out of date instead of writing it.
Output is already in Prettier's format, so a repository-wide prettier --check stays green.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "tokens.json"
TOKENS_CSS = HERE / "tokens.css"
TAILWIND_CSS = HERE / "tailwind-theme.css"
PRINT_WIDTH = 80

# Tailwind namespace for each token path prefix. Paths not listed get no utility class and are
# used through var(--bs-...) directly (motion, layout, size, z, gradients).
TAILWIND_PREFIXES = [
    ("color-bg-", "color-"),
    ("color-surface-", "color-surface-"),
    ("color-border-", "color-line-"),
    ("color-text-", "color-fg-"),
    ("color-brand-", "color-brand-"),
    ("color-accent-default", "color-accent"),
    ("color-accent-", "color-accent-"),
    ("color-decision-", "color-"),
    ("color-modifier-ai-tightened-", "color-tightened-"),
    ("color-lifecycle-", "color-"),
    ("color-demo-", "color-"),
    ("color-status-", "color-"),
    ("color-viz-", "color-viz-"),
    ("font-family-ui", "font-sans"),
    ("font-family-", "font-"),
    ("font-size-", "text-"),
    ("radius-", "radius-"),
    ("shadow-", "shadow-"),
    ("motion-easing-", "ease-"),
    ("layout-bp-", "breakpoint-"),
]

LITERAL_NAMESPACES = ("breakpoint-",)

# Tailwind defaults reset so app code cannot reach for colours, sizes or radii outside the contract.
TAILWIND_RESETS = [
    "--color-*: initial;",
    "--font-*: initial;",
    "--text-*: initial;",
    "--radius-*: initial;",
    "--shadow-*: initial;",
    "--ease-*: initial;",
    "--breakpoint-*: initial;",
    "--spacing: 4px;",
]


def css_value(value, token_type):
    if token_type == "cubicBezier":
        return "cubic-bezier({})".format(", ".join(str(v) for v in value))
    return str(value)


def walk(node, path, inherited_type, out):
    token_type = node.get("$type", inherited_type)
    if "$value" in node:
        out.append(("-".join(path), css_value(node["$value"], token_type)))
        return
    for key, child in node.items():
        if key.startswith("$"):
            continue
        walk(child, path + [key], token_type, out)


def split_top_level(value):
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(value):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(value[start:i].strip())
            start = i + 1
    parts.append(value[start:].strip())
    return parts


def declaration(name, value):
    """One custom property, wrapped the way Prettier 3 wraps it at 80 columns."""
    # Prettier does not count the closing semicolon against the print width.
    if len(f"  {name}: {value}") <= PRINT_WIDTH:
        return [f"  {name}: {value};"]
    single_call = re.fullmatch(r"([a-z-]+)\((.*)\)", value)
    if single_call and len(split_top_level(value)) == 1:
        fn, args = single_call.groups()
        out = [f"  {name}: {fn}("]
        out += [f"    {arg}," for arg in split_top_level(args)]
        out[-1] = out[-1][:-1]
        out.append("  );")
        return out
    if len(f"    {value}") <= PRINT_WIDTH:
        return [f"  {name}:", f"    {value};"]
    out, current = [f"  {name}:"], ""
    for part in split_top_level(value):
        candidate = f"{current}, {part}" if current else part
        if current and len(f"    {candidate},") > PRINT_WIDTH:
            out.append(f"    {current},")
            current = part
        else:
            current = candidate
    out.append(f"    {current};")
    return out


def tailwind_name(path):
    for prefix, namespace in TAILWIND_PREFIXES:
        if path == prefix.rstrip("-") or path.startswith(prefix):
            return namespace + path[len(prefix) :]
    return None


def render(pairs):
    tokens_css = [
        "/* Generated from docs/design/tokens.json by docs/design/build-tokens.py. Do not edit. */",
        ":root {",
        "  color-scheme: dark;",
    ]
    for name, value in pairs:
        tokens_css += declaration(f"--bs-{name}", value)
    tokens_css.append("}")

    tailwind = [
        "/* Generated from docs/design/tokens.json by docs/design/build-tokens.py. Do not edit. */",
        "/* Import after tailwindcss and tokens.css: @import 'tailwindcss'; */",
        "@theme inline {",
    ]
    tailwind += [f"  {reset}" for reset in TAILWIND_RESETS]
    for name, value in pairs:
        mapped = tailwind_name(name)
        if not mapped:
            continue
        # Media queries cannot read custom properties, so breakpoints must be literal.
        literal = any(mapped.startswith(ns) for ns in LITERAL_NAMESPACES)
        tailwind += declaration(f"--{mapped}", value if literal else f"var(--bs-{name})")
    tailwind.append("}")
    return {
        TOKENS_CSS: "\n".join(tokens_css) + "\n",
        TAILWIND_CSS: "\n".join(tailwind) + "\n",
    }


def main():
    pairs = []
    walk(json.loads(SRC.read_text()), [], None, pairs)
    outputs = render(pairs)
    if "--check" in sys.argv:
        stale = [p.name for p, text in outputs.items() if not p.exists() or p.read_text() != text]
        if stale:
            print(f"out of date: {', '.join(stale)}; run python3 docs/design/build-tokens.py")
            return 1
        return 0
    for path, text in outputs.items():
        path.write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
