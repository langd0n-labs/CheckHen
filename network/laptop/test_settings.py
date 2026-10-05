"""Checks for iproute JSON results used by the network setup and test."""
import unittest

from settings import first_ip_json, ip_json_addresses


class IpJsonTests(unittest.TestCase):
    def test_empty_family_filtered_address_result_has_no_addresses(self):
        self.assertEqual(ip_json_addresses("[]"), [])
        self.assertEqual(ip_json_addresses('[{"ifname":"chpeer1","addr_info":[]}]'), [])

    def test_reads_addresses_from_each_interface_result(self):
        self.assertEqual(ip_json_addresses('[{"addr_info":[{"local":"172.16.77.2"}]},'
                                           '{"addr_info":[{"local":"172.16.77.3"}]}]'),
                         [{"local": "172.16.77.2"}, {"local": "172.16.77.3"}])

    def test_required_link_or_route_has_a_clear_empty_result_error(self):
        with self.assertRaisesRegex(RuntimeError, "No IPv4 uplink route returned by ip -j"):
            first_ip_json("[]", "IPv4 uplink route")
        self.assertEqual(first_ip_json('[{"dev":"eth0"}]', "IPv4 uplink route"), {"dev": "eth0"})


if __name__ == "__main__":
    unittest.main()
