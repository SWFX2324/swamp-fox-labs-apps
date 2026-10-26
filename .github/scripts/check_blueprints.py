"""Checks the Home Assistant blueprints: valid YAML, the required sections, a
source_url pointing at the file itself, and every !input defined."""
import glob
import sys

import yaml


class Loader(yaml.SafeLoader):
    pass


def input_tag(loader, node):
    return {"__input__": loader.construct_scalar(node)}


Loader.add_constructor("!input", input_tag)


def used_inputs(value):
    if isinstance(value, dict):
        if "__input__" in value:
            yield value["__input__"]
        for v in value.values():
            yield from used_inputs(v)
    elif isinstance(value, list):
        for v in value:
            yield from used_inputs(v)


errors = []
files = sorted(glob.glob("blueprints/automation/*.yaml"))
if not files:
    errors.append("no blueprints found")
for path in files:
    with open(path, encoding="utf-8") as f:
        try:
            doc = yaml.load(f, Loader=Loader)
        except yaml.YAMLError as e:
            errors.append(f"{path}: invalid YAML: {e}")
            continue
    bp = doc.get("blueprint") or {}
    for key in ("name", "description", "domain", "source_url", "input"):
        if not bp.get(key):
            errors.append(f"{path}: blueprint.{key} is missing")
    if bp.get("domain") != "automation":
        errors.append(f"{path}: domain should be automation")
    if not str(bp.get("source_url", "")).endswith(path):
        errors.append(f"{path}: source_url should point at this file")
    for key in ("triggers", "actions"):
        if key not in doc:
            errors.append(f"{path}: {key} is missing")
    defined = set((bp.get("input") or {}).keys())
    for name in set(used_inputs({k: v for k, v in doc.items() if k != "blueprint"})):
        if name not in defined:
            errors.append(f"{path}: !input {name} is not defined")
    for name in defined:
        if name not in set(used_inputs(doc)):
            errors.append(f"{path}: input {name} is never used")
    print(f"{path}: {len(defined)} inputs")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"{len(files)} blueprints OK")
