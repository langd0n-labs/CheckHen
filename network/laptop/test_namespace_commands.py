"""Namespace test command contract."""
import unittest
from unittest.mock import patch

import test_namespace


class NamespaceCommandTests(unittest.TestCase):
    def test_accept_ra_uses_a_shell_available_in_the_network_image(self):
        with patch.object(test_namespace, "namespace") as namespace:
            test_namespace.set_accept_ra("chpeer0", "checkhen-m2")
        namespace.assert_called_once_with(
            "sh", "-c", "printf 2 > /proc/sys/net/ipv6/conf/chpeer0/accept_ra",
            name="checkhen-m2")


if __name__ == "__main__":
    unittest.main()
