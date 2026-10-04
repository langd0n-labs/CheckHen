"""Checks for the route guard that runs before any host network change."""
import ipaddress
import json
import sys
import unittest
from unittest.mock import patch

import classroom


class RouteGuardTests(unittest.TestCase):
    def test_rejects_overlapping_host_route(self):
        routes = [{"dst": "default", "dev": "wlan0"},
                  {"dst": "172.16.77.128/25", "dev": "tun0"}]
        with patch.object(classroom, "run", return_value=type("Result", (), {"stdout": json.dumps(routes)})()):
            self.assertEqual(classroom.conflicting_routes(ipaddress.IPv4Network("172.16.77.0/24")),
                             ["172.16.77.128/25 on tun0"])

    def test_ignores_default_route_and_nonoverlapping_vpn(self):
        routes = [{"dst": "default", "dev": "wlan0"},
                  {"dst": "172.16.100.2", "dev": "rfkill"}]
        with patch.object(classroom, "run", return_value=type("Result", (), {"stdout": json.dumps(routes)})()):
            self.assertEqual(classroom.conflicting_routes(ipaddress.IPv4Network("172.16.77.0/24")), [])

    def test_reserved_ranges(self):
        for subnet in ("10.77.0.0/24", "172.17.77.0/24", "172.31.77.0/24",
                       "172.16.100.0/24"):
            self.assertTrue(any(ipaddress.IPv4Network(subnet).overlaps(block)
                                for block in classroom.RESERVED))
        self.assertFalse(any(ipaddress.IPv4Network("172.16.77.0/24").overlaps(block)
                             for block in classroom.RESERVED))

    def test_preflight_refuses_conflicting_route(self):
        with (patch.object(sys, "argv", ["classroom.py", "check"]),
              patch.object(classroom, "read_env", return_value={}),
              patch.object(classroom, "validate", return_value=(
                  ipaddress.IPv4Network("172.16.77.0/24"),
                  ipaddress.IPv4Address("172.16.77.1"))),
              patch.object(classroom, "conflicting_routes", return_value=["172.16.77.0/24 on wg0"])):
            with self.assertRaisesRegex(SystemExit, "overlaps an existing host route"):
                classroom.main()


if __name__ == "__main__":
    unittest.main()
