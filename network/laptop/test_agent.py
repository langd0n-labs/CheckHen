"""Signed admission and restart checks for the portal agent."""
import hashlib
import hmac
from http.server import HTTPServer
import ipaddress
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import agent


class AgentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for name, path in (("BINDINGS", "bindings.json"), ("LEASES", "leases")):
            mock = patch.object(agent, name, Path(directory.name) / path)
            mock.start()
            self.addCleanup(mock.stop)
        nft = patch.object(agent, "nft")
        self.nft = nft.start()
        self.addCleanup(nft.stop)
        agent.Handler.secret = "test-secret-" * 4
        agent.Handler.subnet = ipaddress.IPv4Network("172.16.77.0/24")
        self.lease("02:00:00:00:00:20")

    def lease(self, mac):
        agent.LEASES.write_text(f"{int(time.time()) + 3600} {mac} 172.16.77.20 host *\n")

    def request(self, path, data=None, signed=True):
        payload = json.dumps(data or {"courseId": "course", "classId": "class", "userId": "student",
                                      "ip": "172.16.77.20", "timestamp": int(time.time() * 1000)}).encode()
        signature = hmac.new(agent.Handler.secret.encode(), payload, hashlib.sha256).hexdigest()
        server = HTTPServer(("127.0.0.1", 0), agent.Handler)
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/{path}", payload,
                                         {"X-CheckHen-Signature": signature if signed else "wrong"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            return code
        finally:
            thread.join(timeout=3)
            server.server_close()

    def test_signature_and_expiry(self):
        self.assertEqual(self.request("bind", signed=False), 403)
        self.assertEqual(self.request("bind", {"timestamp": 1}), 403)
        self.assertEqual(self.request("bind"), 200)
        self.nft.assert_called_once_with("add", "172.16.77.20", "02:00:00:00:00:20")

    def test_outside_subnet_and_missing_lease(self):
        self.assertEqual(self.request("bind", {"courseId": "course", "classId": "class",
                                               "userId": "student", "ip": "192.0.2.20",
                                               "timestamp": int(time.time() * 1000)}), 403)
        agent.LEASES.write_text("")
        self.assertEqual(self.request("bind"), 403)
        self.nft.assert_not_called()

    def test_changed_mac_and_revoke_mismatch(self):
        self.assertEqual(self.request("bind"), 200)
        self.lease("02:00:00:00:00:21")
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.nft.call_args_list[-2].args, ("delete", "172.16.77.20", "02:00:00:00:00:20"))
        self.assertEqual(self.nft.call_args_list[-1].args, ("add", "172.16.77.20", "02:00:00:00:00:21"))
        wrong = {"courseId": "course", "classId": "class", "userId": "other",
                 "ip": "172.16.77.20", "timestamp": int(time.time() * 1000)}
        self.assertEqual(self.request("revoke", wrong), 403)
        self.assertEqual(self.request("revoke-student"), 200)
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})

    def test_restart_reconciles_stale_bindings(self):
        agent.save({"172.16.77.20": {"mac": "02:00:00:00:00:20", "userId": "student",
                                         "courseId": "course", "classId": "class"},
                    "172.16.77.21": {"mac": "02:00:00:00:00:21", "userId": "other",
                                         "courseId": "course", "classId": "class"}})
        with patch.object(agent.subprocess, "run") as run:
            agent.reconcile_bindings()
        run.assert_called_once()
        self.nft.assert_called_once_with("add", "172.16.77.20", "02:00:00:00:00:20")
        self.assertEqual(list(json.loads(agent.BINDINGS.read_text())), ["172.16.77.20"])

    def test_session_end_revokes_all_bound_students(self):
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.request("revoke-session"), 200)
        self.nft.assert_any_call("delete", "172.16.77.20", "02:00:00:00:00:20")
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})

    def test_expired_lease_and_departed_station_are_pruned(self):
        self.assertEqual(self.request("bind"), 200)
        with patch.object(agent, "station_macs", return_value=set()):
            agent.prune_bindings("wlan-test")
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})
        self.assertEqual(self.request("bind"), 200)
        agent.LEASES.write_text("")
        agent.prune_bindings(None)
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})

    def test_station_dump_parsing(self):
        output = type("Result", (), {"returncode": 0,
                "stdout": "Station 02:00:00:00:00:20 (on wlan0)\n\tinactive time: 1 ms\n"})()
        with patch.object(agent.subprocess, "run", return_value=output):
            self.assertEqual(agent.station_macs("wlan0"), {"02:00:00:00:00:20"})


if __name__ == "__main__":
    unittest.main()
