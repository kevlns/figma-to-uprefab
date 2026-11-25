# Copyright © 2026 Vant <sl_kevln@163.com>
"""Capture the Unity payloads of published stable npm versions. Never execute package scripts."""
import base64
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
registry = "https://registry.npmjs.org/"
with urlopen(registry + "@kevlns%2Ffigma-to-uprefab", timeout=30) as response:
    versions = json.load(response)["versions"]
trees = {}
for version, manifest in versions.items():
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        continue
    dist = manifest["dist"]
    if not dist["tarball"].startswith(registry):
        raise ValueError("Unexpected release registry")
    with urlopen(dist["tarball"], timeout=45) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024 or "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode() != dist["integrity"]:
        raise ValueError("Release integrity mismatch: " + version)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = [m for m in archive.getmembers() if m.name.startswith("package/unity-package/") and m.isfile()]
        manifests = [m for m in members if m.name.endswith("/package.json") and json.load(archive.extractfile(m)).get("name") == "com.kevlns.figma-to-uprefab"]
        if not manifests:
            continue
        if len(manifests) != 1:
            raise ValueError("Ambiguous Unity manifest: " + version)
        prefix = manifests[0].name[:-len("package.json")]
        tree = sorted([[m.name[len(prefix):], hashlib.sha256(archive.extractfile(m).read()).hexdigest()] for m in members if m.name.startswith(prefix)])
        encoded = json.dumps(tree, ensure_ascii=False, separators=(",", ":")).encode()
        trees[version] = hashlib.sha256(encoded).hexdigest()
if not trees:
    raise ValueError("Registry supplied no supported Unity payloads")
(root / "src/core/release-trees.json").write_text(json.dumps(trees, indent=2) + "\n", encoding="utf-8")
print("Verified", len(trees), "published package trees")
