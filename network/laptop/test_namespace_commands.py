"""Namespace test command contract."""
import unittest
import subprocess
from unittest.mock import patch

import test_namespace


class NamespaceCommandTests(unittest.TestCase):
    def test_accept_ra_uses_a_shell_available_in_the_network_image(self):
        with patch.object(test_namespace, "namespace") as namespace:
            test_namespace.set_accept_ra("chpeer0", "checkhen-m2")
        namespace.assert_called_once_with(
            "sh", "-c", "printf 2 > /proc/sys/net/ipv6/conf/chpeer0/accept_ra",
            name="checkhen-m2")

    def test_narrow_client_route_is_added_and_removed_in_its_namespace(self):
        with patch.object(test_namespace, "namespace") as namespace:
            test_namespace.client_ipv6_route("replace", "checkhen-m2", "chpeer0",
                                             "2606:4700:4700::1111", "fd9b:2f69:8c44::1")
            test_namespace.client_ipv6_route("delete", "checkhen-m2", "chpeer0",
                                             "2606:4700:4700::1111", "fd9b:2f69:8c44::1")
        self.assertEqual(namespace.call_args_list[0].args, (
            "ip", "-6", "route", "replace", "2606:4700:4700::1111/128",
            "via", "fd9b:2f69:8c44::1", "dev", "chpeer0"))
        self.assertFalse(namespace.call_args_list[1].kwargs["check"])

    def test_no_uplink_installs_public_routes_for_both_clients_and_private_route_for_second(self):
        added = []
        with patch.object(test_namespace, "client_ipv6_route") as route:
            test_namespace.install_client_test_routes("2606:4700:4700::1111", "fd00::1",
                                                      "fd9b:2f69:8c44::1", added)
        self.assertEqual(added, [
            (test_namespace.NAMESPACE, test_namespace.CLIENT_IF, "2606:4700:4700::1111"),
            (test_namespace.SECOND_NAMESPACE, test_namespace.SECOND_CLIENT_IF, "2606:4700:4700::1111"),
            (test_namespace.SECOND_NAMESPACE, test_namespace.SECOND_CLIENT_IF, "fd00::1"),
        ])
        self.assertEqual(route.call_count, 3)

    def test_counter_failure_contains_routes_addresses_curl_and_counters(self):
        def result(value):
            return subprocess.CompletedProcess([], 1, value, "")
        with patch.object(test_namespace, "namespace", side_effect=[result("route"), result("address")]), \
             patch.object(test_namespace, "run", return_value=result("counter")):
            error = test_namespace.ipv6_counter_failure("drop did not increment", "checkhen-m2",
                                                        subprocess.CompletedProcess([], 7, "", "No route"))
        for expected in ("route", "address", "curl exit 7: No route", "counter"):
            self.assertIn(expected, str(error))


if __name__ == "__main__":
    unittest.main()
