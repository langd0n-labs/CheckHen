"""Unit checks for AP attendance admission."""
import ipaddress
import unittest

from agent import ap_client_ip


class AttendanceAdmissionTests(unittest.TestCase):
    def test_accepts_ap_client(self):
        subnet = ipaddress.IPv4Network("172.16.77.0/24")
        self.assertEqual(ap_client_ip("172.16.77.20", subnet), "172.16.77.20")

    def test_rejects_outside_ap_subnet(self):
        subnet = ipaddress.IPv4Network("172.16.77.0/24")
        with self.assertRaisesRegex(PermissionError, "Outside AP subnet"):
            ap_client_ip("192.0.2.20", subnet)


if __name__ == "__main__":
    unittest.main()
