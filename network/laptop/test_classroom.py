"""Checks for the route guard that runs before any host network change."""
import ipaddress
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import classroom


class RouteGuardTests(unittest.TestCase):
    def test_ap_configures_dual_stack_slaac_and_private_uplink_blocks(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(classroom, "STATE", Path(directory)):
            classroom.write_configs({"AP_INTERFACE": "chbr0", "UPLINK_INTERFACE": "eth0",
                                     "AP_SSID": "CheckHen", "AP_PASSPHRASE": "password123"},
                                    ipaddress.IPv4Network("172.16.77.0/24"),
                                    ipaddress.IPv4Address("172.16.77.1"))
            rules = (Path(directory) / "firewall.nft").read_text()
            self.assertIn("table ip6 checkhen6", rules)
            self.assertIn("set authorized6 { type ether_addr; }", rules)
            self.assertIn('iifname "chbr0" ether saddr @authorized6 oifname "eth0" accept', rules)
            self.assertIn('iifname "chbr0" ip6 daddr @private6 counter drop', rules)
            self.assertIn('iifname "chbr0" drop', rules)
            self.assertIn('iifname "chbr0" ip daddr @private4 counter drop', rules)
            self.assertIn("enable-ra", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("constructor:chbr0,ra-only,64", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("ap_isolate=1", (Path(directory) / "hostapd.conf").read_text())

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

    def test_rejects_overlapping_ipv6_host_route(self):
        routes = [{"dst": "default", "dev": "wlan0"},
                  {"dst": "fd9b:2f69:8c44::/64", "dev": "wg0"}]
        with patch.object(classroom, "run", return_value=type("Result", (), {"stdout": json.dumps(routes)})()):
            self.assertEqual(classroom.conflicting_ipv6_routes(ipaddress.IPv6Network("fd9b:2f69:8c44::/64")),
                             ["fd9b:2f69:8c44::/64 on wg0"])

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
