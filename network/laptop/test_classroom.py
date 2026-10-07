"""Checks for the route guard that runs before any host network change."""
import ipaddress
import json
import socket
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

import classroom


class RouteGuardTests(unittest.TestCase):
    def test_ipv6_forwarding_saves_ra_routes_and_restores_sysctls(self):
        values = {
            "/proc/sys/net/ipv6/conf/eth0/accept_ra": "1",
            "/proc/sys/net/ipv6/conf/wlan0/accept_ra": "0",
            "/proc/sys/net/ipv6/conf/all/forwarding": "0",
            "/proc/sys/net/ipv6/conf/eth0/forwarding": "0",
            "/proc/sys/net/ipv6/conf/wlan0/forwarding": "0",
        }
        writes = []
        def fake_path(name):
            path = MagicMock()
            path.read_text.side_effect = lambda: values[str(name)]
            path.write_text.side_effect = lambda value: (writes.append((str(name), value)), values.__setitem__(str(name), value.strip()))
            return path
        routes = type("Result", (), {"stdout": json.dumps([{"dev": "wlan0", "protocol": "ra"}])})()
        with patch.object(classroom, "run", return_value=routes) as run, patch.object(classroom, "Path", side_effect=fake_path):
            state = {"ap": "chbr0", "uplink": "eth0", "forward6": values["/proc/sys/net/ipv6/conf/all/forwarding"],
                     "forward6_interfaces": {"eth0": "0", "wlan0": "0"},
                     "accept_ra6": classroom.ra_route_interfaces("eth0")}
            run.assert_called_once_with("ip", "-6", "-j", "route", "show", "table", "all", "default")
            classroom.enable_ipv6_forwarding(state)
            self.assertEqual(writes[:3], [
                ("/proc/sys/net/ipv6/conf/eth0/accept_ra", "2\n"),
                ("/proc/sys/net/ipv6/conf/wlan0/accept_ra", "2\n"),
                ("/proc/sys/net/ipv6/conf/all/forwarding", "1\n")])
            errors = []
            classroom.restore_ipv6_forwarding(state, errors)
            self.assertEqual(errors, [])
            self.assertEqual(writes[3:], [
                ("/proc/sys/net/ipv6/conf/all/forwarding", "0\n"),
                ("/proc/sys/net/ipv6/conf/eth0/forwarding", "0\n"),
                ("/proc/sys/net/ipv6/conf/wlan0/forwarding", "0\n"),
                ("/proc/sys/net/ipv6/conf/eth0/accept_ra", "1\n"),
                ("/proc/sys/net/ipv6/conf/wlan0/accept_ra", "0\n")])
            self.assertEqual(values["/proc/sys/net/ipv6/conf/all/forwarding"], "0")
            self.assertEqual(values["/proc/sys/net/ipv6/conf/eth0/accept_ra"], "1")
            self.assertEqual(values["/proc/sys/net/ipv6/conf/wlan0/accept_ra"], "0")

    def test_ap_configures_dual_stack_slaac_and_private_uplink_blocks(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(classroom, "STATE", Path(directory)):
            classroom.write_configs({"AP_INTERFACE": "chbr0", "UPLINK_INTERFACE": "eth0",
                                     "AP_SSID": "CheckHen", "AP_PASSPHRASE": "password123"},
                                    ipaddress.IPv4Network("172.16.77.0/24"),
                                    ipaddress.IPv4Address("172.16.77.1"))
            rules = (Path(directory) / "firewall.nft").read_text()
            self.assertIn('iifname "chbr0" jump exam_gate', rules)
            self.assertIn('set exam4 { type ipv4_addr; }', rules)
            self.assertIn('set exam6 { type ipv6_addr; }', rules)
            self.assertIn("table ip6 checkhen6", rules)
            self.assertIn("set authorized6 { type ether_addr; }", rules)
            self.assertIn('iifname "chbr0" ip6 saddr fd9b:2f69:8c44::/64 ether saddr @authorized6 oifname "eth0" counter accept', rules)
            for private in ("::ffff:0:0/96", "64:ff9b::/96", "2001::/32", "2002::/16"):
                self.assertIn(private, rules)
            self.assertIn('iifname "chbr0" ip6 daddr @private6 counter drop', rules)
            self.assertIn('iifname "chbr0" tcp dport 80 dnat to fd9b:2f69:8c44::1', rules)
            self.assertIn('iifname "chbr0" drop', rules)
            self.assertIn('iifname "chbr0" ip daddr @private4 counter drop', rules)
            self.assertIn("enable-ra", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("servers-file=", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("max-ttl=30", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("constructor:chbr0,ra-only,64", (Path(directory) / "dnsmasq.conf").read_text())
            self.assertIn("ap_isolate=1", (Path(directory) / "hostapd.conf").read_text())
            self.assertIn("ap_max_inactivity=10", (Path(directory) / "hostapd.conf").read_text())
            self.assertIn("nftset=/#/4#ip#checkhen#exam4,6#ip6#checkhen6#exam6",
                          (Path(directory) / "dnsmasq.conf").read_text())

    def test_ipv4_preauth_survives_missing_aaaa(self):
        def lookup(_name, _port, family):
            if family == socket.AF_INET6:
                raise socket.gaierror(socket.EAI_NONAME, "No AAAA")
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.51.100.10", 443))]
        with patch.object(classroom.socket, "getaddrinfo", side_effect=lookup), patch.object(classroom, "run") as run:
            classroom.seed_preauth({"PREAUTH_DOMAINS": "ipv4-only.example"})
        run.assert_called_once_with("nft", "add", "element", "ip", "checkhen", "preauth4",
                                    "{", "198.51.100.10", "}")

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
