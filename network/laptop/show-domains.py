#!/usr/bin/env python3
"""Show only queried hostnames from the local dnsmasq trace."""
from pathlib import Path
import re


LOG = Path("/run/checkhen/dnsmasq/query.log")
QUERY = re.compile(r"query\[[^]]+\] ([^ ]+) from ")


def main() -> None:
    names = {match.group(1).lower() for line in LOG.read_text().splitlines()
             if (match := QUERY.search(line))}
    for name in sorted(names):
        print(name)


if __name__ == "__main__":
    main()
