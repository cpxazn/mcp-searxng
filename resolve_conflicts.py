#!/usr/bin/env python3
import re
import sys

files = sys.argv[1:]

old_pattern = re.compile(
    r"<<<<<<< HEAD\n"
    r"import { fileURLToPath } from 'node:url';\n"
    r"if \(fileURLToPath\(import\.meta\.url\) === process\.argv\[1\]\) \{\n"
    r"=======\n"
    r"if \(process\.argv\[1\] !== undefined && fileURLToPath\(import\.meta\.url\) === process\.argv\[1\]\) \{\n"
    r">>>>>>> [a-f0-9]+ \(feat: improve test execution condition by using fileURLToPath for better compatibility\)\n"
)

new_text = "if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {\n"

for f in files:
    with open(f, 'r') as fh:
        content = fh.read()
    
    if old_pattern.search(content):
        content = old_pattern.sub(new_text, content)
        with open(f, 'w') as fh:
            fh.write(content)
        print(f"Resolved: {f}")
    else:
        print(f"NO MATCH: {f}")
