"""Reads a dotenv file (as `vercel env pull` writes it) and prints KEY NUL VALUE NUL pairs.

Used by setup.sh so values reach Secret Manager exactly as the app saw them on Vercel:
- double-quoted values may span lines and have their escapes decoded (\\n, \\r, \\t, \\", \\\\);
- single-quoted values are literal;
- unquoted values are trimmed and lose a trailing " # comment".
A value that looks like JSON must parse (JSON.parse in the app is strict), or the script stops and
names the key. Values are never printed to the terminal.
"""
import json
import re
import sys

ESCAPES = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
KEY = re.compile(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*")


def parse(text):
    i, out = 0, []
    while i < len(text):
        end = text.find("\n", i)
        end = len(text) if end == -1 else end
        line = text[i:end]
        match = KEY.match(line)
        if not match or line.lstrip().startswith("#"):
            i = end + 1
            continue
        key, j = match.group(1), i + match.end()
        if j < len(text) and text[j] == '"':
            j += 1
            chars = []
            while j < len(text) and text[j] != '"':
                if text[j] == "\\" and j + 1 < len(text) and text[j + 1] in ESCAPES:
                    chars.append(ESCAPES[text[j + 1]])
                    j += 2
                else:
                    chars.append(text[j])
                    j += 1
            if j >= len(text):
                sys.exit(f"{key}: unterminated double-quoted value")
            value = "".join(chars)
            end = text.find("\n", j)
            end = len(text) if end == -1 else end
        elif j < len(text) and text[j] == "'":
            close = text.find("'", j + 1)
            if close == -1:
                sys.exit(f"{key}: unterminated single-quoted value")
            value = text[j + 1:close]
            end = text.find("\n", close)
            end = len(text) if end == -1 else end
        else:
            value = re.sub(r"\s+#.*$", "", text[j:end]).strip()
        out.append((key, value))
        i = end + 1
    return out


def checked(key, value):
    if not value.lstrip().startswith(("{", "[")):
        return value
    try:
        json.loads(value)
        return value
    except ValueError:
        pass
    try:
        # Raw newlines inside JSON strings (an unescaped private key): re-encode them.
        return json.dumps(json.loads(value, strict=False), separators=(",", ":"))
    except ValueError:
        sys.exit(f"{key}: value looks like JSON but does not parse")


def main():
    with open(sys.argv[1], encoding="utf-8") as handle:
        text = handle.read().replace("\r\n", "\n")
    for key, value in parse(text):
        sys.stdout.write(f"{key}\0{checked(key, value)}\0")


if __name__ == "__main__":
    main()
