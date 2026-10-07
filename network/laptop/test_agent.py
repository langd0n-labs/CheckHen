"""Signed admission and restart checks for the portal agent."""
import hashlib
import hmac
from http.server import HTTPServer
import ipaddress
import json
import subprocess
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import agent
import exam

REAL_NFT = agent.nft
REAL_NFT6 = agent.nft6


class AgentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for name, path in (("BINDINGS", "bindings.json"), ("LEASES", "leases"),
                           ("PENDING", "pending-checkouts.json")):
            mock = patch.object(agent, name, Path(directory.name) / path)
            mock.start()
            self.addCleanup(mock.stop)
        nft = patch.object(agent, "nft")
        self.nft = nft.start()
        self.addCleanup(nft.stop)
        nft6 = patch.object(agent, "nft6")
        self.nft6 = nft6.start()
        self.addCleanup(nft6.stop)
        agent.Handler.secret = "test-secret-" * 4
        agent.Handler.subnet = ipaddress.IPv4Network("172.16.77.0/24")
        agent.Handler.ipv6_subnet = ipaddress.IPv6Network("fd9b:2f69:8c44::/64")
        agent.Handler.interface = "wlan-test"
        self.lease("02:00:00:00:00:20")

    def lease(self, mac):
        agent.LEASES.write_text(f"{int(time.time()) + 3600} {mac} 172.16.77.20 host *\n")

    def second_prune(self):
        with patch.object(agent.time, "time", return_value=time.time() + 2):
            agent.prune_bindings(None)

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

    def test_exam_routes_require_signature_and_preserve_bound_device(self):
        scope = {"courseId": "course", "classId": "class", "timestamp": int(time.time() * 1000)}
        with patch.object(exam, "start", return_value={"examId": "exam"}) as start, \
             patch.object(exam, "read", return_value={"examId": "exam"}):
            self.assertEqual(self.request("exam-start", {**scope, "examId": "exam", "domains": ["exam.example.edu"],
                "thresholdSeconds": 30, "clients": [{"userId": "student", "mac": "02:00:00:00:00:20"}]}, signed=False), 403)
            self.assertEqual(self.request("exam-start", {**scope, "examId": "exam", "domains": ["exam.example.edu"],
                "thresholdSeconds": 30, "clients": [{"userId": "student", "mac": "02:00:00:00:00:20"}]}), 200)
            start.assert_called_once()
            self.assertEqual(self.request("bind"), 403)
        self.assertEqual(self.request("bind"), 200)
        with patch.object(exam, "read", return_value={"examId": "exam"}):
            self.assertEqual(self.request("bind"), 200)
            agent.LEASES.write_text(f"{int(time.time()) + 3600} 02:00:00:00:00:20 172.16.77.21 host *\n")
            self.assertEqual(self.request("bind", {**scope, "userId": "student", "ip": "172.16.77.21"}), 200)
            self.lease("02:00:00:00:00:21")
            self.assertEqual(self.request("bind"), 403)

    def test_heartbeat_without_an_exam_leaves_the_exam_gate_alone(self):
        scope = {"courseId": "course", "classId": "class", "userId": "student",
                 "timestamp": int(time.time() * 1000)}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(exam, "EXAM", Path(directory) / "exam.json"), \
             patch.object(exam.subprocess, "run") as run:
            self.assertEqual(self.request("exam-heartbeat", scope), 200)
            self.assertFalse(exam.EXAM.exists())
        run.assert_not_called()
        self.nft.assert_not_called()
        self.nft6.assert_not_called()

    def lock_is_free(self):
        """True when another thread can take the agent lock right now."""
        result = []
        def probe():
            taken = agent.LOCK.acquire(timeout=0.2)
            result.append(taken)
            if taken:
                agent.LOCK.release()
        thread = threading.Thread(target=probe)
        thread.start()
        thread.join()
        return result[0]

    def test_requests_wait_for_the_lock(self):
        held, release = threading.Event(), threading.Event()
        def hold():
            with agent.LOCK:
                held.set()
                release.wait(5)
        holder = threading.Thread(target=hold)
        holder.start()
        held.wait(5)
        results = []
        requester = threading.Thread(target=lambda: results.append(self.request("bind")))
        requester.start()
        requester.join(0.5)
        # The bind waits while the monitor holds the lock, then completes.
        self.assertEqual(results, [])
        self.nft.assert_not_called()
        release.set()
        holder.join(5)
        requester.join(5)
        self.assertEqual(results, [200])

    def test_fail_callbacks_run_outside_the_lock(self):
        fail = {"courseId": "course", "classId": "class", "examId": "exam", "userId": "student",
                "failId": "fail-1"}
        state = {"courseId": "course", "classId": "class", "examId": "exam"}
        free = []
        def notify(*_args):
            free.append(self.lock_is_free())
            return True
        with patch.object(exam, "read", return_value=state), \
             patch.object(exam, "unreported", side_effect=[[fail], [], []]), \
             patch.object(exam, "seed_due", return_value=[]), \
             patch.object(exam, "mark_reported"), patch.object(exam, "stop"), \
             patch.object(exam, "notify_fail", side_effect=notify):
            agent.worker_pass("http://127.0.0.1:9/checkout", "127.0.0.1")
            scope = {"courseId": "course", "classId": "class", "timestamp": int(time.time() * 1000)}
            with patch.object(exam, "unreported", side_effect=[[fail], []]):
                self.assertEqual(self.request("exam-stop", scope), 200)
        self.assertEqual(free, [True, True])

    def test_exam_status_reports_monitor_health(self):
        scope = {"courseId": "course", "classId": "class", "timestamp": int(time.time() * 1000)}
        state = {"courseId": "course", "classId": "class", "examId": "exam", "thresholdSeconds": 30,
                 "clients": {}}
        payload = json.dumps(scope).encode()
        signature = hmac.new(agent.Handler.secret.encode(), payload, hashlib.sha256).hexdigest()
        server = HTTPServer(("127.0.0.1", 0), agent.Handler)
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        with patch.object(exam, "read", return_value=state), \
             patch.object(exam, "connection_status") as fold, patch.object(exam, "save") as save, \
             patch.object(agent.Handler, "monitor_at", time.time() - 60), \
             patch.object(agent.Handler, "monitor_error", "OSError"):
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/exam-status",
                                             payload, {"X-CheckHen-Signature": signature})
            with urllib.request.urlopen(request, timeout=3) as response:
                body = json.loads(response.read())
        thread.join(3)
        server.server_close()
        self.assertEqual(body["monitor"], {"healthy": False, "error": "OSError"})
        # Status is read-only: only the detection thread folds evidence.
        fold.assert_not_called()
        save.assert_not_called()

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
        self.assertEqual(run.call_count, 2)
        self.nft.assert_called_once_with("add", "172.16.77.20", "02:00:00:00:00:20")
        self.assertEqual(list(json.loads(agent.BINDINGS.read_text())), ["172.16.77.20"])

    def test_session_end_revokes_all_bound_students(self):
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.request("revoke-session"), 200)
        self.nft.assert_any_call("delete", "172.16.77.20", "02:00:00:00:00:20")
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})

    def test_departure_keeps_binding_until_lease_expires(self):
        self.assertEqual(self.request("bind"), 200)
        with patch.object(agent, "station_activity", return_value={}):
            agent.prune_bindings("wlan-test")
        self.assertIn("172.16.77.20", json.loads(agent.BINDINGS.read_text()))
        agent.LEASES.write_text("")
        agent.prune_bindings(None)
        self.assertIn("172.16.77.20", agent.read_bindings())
        self.second_prune()
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})
        self.assertEqual(json.loads(agent.PENDING.read_text()), [{
            "userId": "student", "courseId": "course", "classId": "class"}])

    def test_expired_binding_notifies_app_with_signed_checkout(self):
        self.assertEqual(self.request("bind"), 200)
        agent.LEASES.write_text("")
        agent.prune_bindings(None)
        self.second_prune()
        response = type("Response", (), {"status": 200, "__enter__": lambda self: self,
                                          "__exit__": lambda self, *_args: None})()
        with patch.object(agent.urllib.request, "urlopen", return_value=response) as send:
            agent.flush_checkout_notifications(agent.Handler.secret, "http://127.0.0.1:3000/api/internal/portal-expired", {})
        request = send.call_args.args[0]
        expected = hmac.new(agent.Handler.secret.encode(), request.data, hashlib.sha256).hexdigest()
        self.assertEqual(request.get_header("X-checkhen-signature"), expected)
        self.assertEqual(json.loads(agent.PENDING.read_text()), [])

    def test_station_dump_parsing(self):
        output = type("Result", (), {"returncode": 0, "stdout":
                "Station 02:00:00:00:00:20 (on wlan0)\n\tinactive time:\t1500 ms\n\trx bytes:\t1\n"
                "Station 02:00:00:00:00:21 (on wlan0)\n\tinactive time: 12 ms\n"})()
        with patch.object(agent.subprocess, "run", return_value=output):
            self.assertEqual(agent.station_activity("wlan0"),
                             {"02:00:00:00:00:20": 1.5, "02:00:00:00:00:21": 0.012})
        failed = type("Result", (), {"returncode": 1, "stdout": ""})()
        with patch.object(agent.subprocess, "run", return_value=failed):
            self.assertIsNone(agent.station_activity("wlan0"))

    def test_same_mac_bind_readds_missing_nft_element(self):
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.nft.call_count, 2)
        self.nft.assert_called_with("add", "172.16.77.20", "02:00:00:00:00:20")

    def test_ipv6_temporary_address_binds_by_neighbor_mac(self):
        data = {"courseId": "course", "classId": "class", "userId": "student",
                "ip": "fd9b:2f69:8c44::20", "timestamp": int(time.time() * 1000)}
        with patch.object(agent, "neighbor_mac", return_value="02:00:00:00:00:20"):
            self.assertEqual(self.request("bind", data), 200)
        self.nft6.assert_called_with("add", "02:00:00:00:00:20")
        self.nft.assert_called_with("add", "172.16.77.20", "02:00:00:00:00:20")
        self.assertIn("fd9b:2f69:8c44::20", agent.read_bindings())
        self.assertEqual(self.request("revoke", data), 200)
        self.nft6.assert_called_with("delete", "02:00:00:00:00:20")
        self.assertEqual(agent.read_bindings(), {})

    def test_failed_rekey_does_not_leave_stale_binding(self):
        self.assertEqual(self.request("bind"), 200)
        self.lease("02:00:00:00:00:21")
        self.nft.side_effect = [None, subprocess.CalledProcessError(1, "nft")]
        self.assertEqual(self.request("bind"), 503)
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})
        self.nft.side_effect = None
        self.assertEqual(self.request("bind"), 200)

    def test_missing_element_delete_is_safe(self):
        self.assertEqual(self.request("bind"), 200)
        self.assertEqual(self.request("revoke"), 200)
        self.assertEqual(json.loads(agent.BINDINGS.read_text()), {})

    def test_nft_delete_uses_missing_element_safe_destroy(self):
        with patch.object(agent.subprocess, "run") as run:
            REAL_NFT("delete", "172.16.77.20", "02:00:00:00:00:20")
            REAL_NFT6("delete", "02:00:00:00:00:20")
        self.assertIn("destroy element ip checkhen authorized4", run.call_args_list[0].kwargs["input"])
        self.assertIn("destroy element ip6 checkhen6 authorized6", run.call_args_list[1].kwargs["input"])

    def test_corrupt_bindings_file_is_quarantined(self):
        agent.BINDINGS.write_text("{bad json")
        self.assertEqual(agent.read_bindings(), {})
        self.assertTrue(agent.BINDINGS.with_suffix(".corrupt").exists())

    def test_corrupt_bindings_restart_flushes_live_nft_entries(self):
        agent.BINDINGS.write_text("{bad json")
        with patch.object(agent.subprocess, "run") as run:
            agent.reconcile_bindings()
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0][:5],
                         ["nft", "flush", "set", "ip", "checkhen"])
        self.assertEqual(run.call_args_list[1].args[0][:5],
                         ["nft", "flush", "set", "ip6", "checkhen6"])
        self.assertEqual(agent.read_bindings(), {})

    def test_one_lease_file_miss_recovers_without_checkout(self):
        self.assertEqual(self.request("bind"), 200)
        agent.LEASES.write_text("")
        agent.prune_bindings(None)
        self.assertEqual(agent.read_bindings()["172.16.77.20"]["leaseMisses"], 1)
        self.lease("02:00:00:00:00:20")
        agent.prune_bindings(None)
        self.assertNotIn("leaseMisses", agent.read_bindings()["172.16.77.20"])
        self.assertFalse(agent.PENDING.exists())

    def test_ipv6_expiry_and_heartbeat_refresh(self):
        data = {"courseId": "course", "classId": "class", "userId": "student",
                "ip": "fd9b:2f69:8c44::20", "timestamp": int(time.time() * 1000)}
        with patch.object(agent, "neighbor_mac", return_value="02:00:00:00:00:20"):
            self.assertEqual(self.request("bind", data), 200)
            first_expiry = agent.read_bindings()[data["ip"]]["expiresAt"]
            self.assertAlmostEqual(first_expiry - time.time(), 43200, delta=2)
            with patch.object(agent.time, "time", return_value=time.time() + 60):
                data["timestamp"] = int(agent.time.time() * 1000)
                self.assertEqual(self.request("bind", data), 200)
            refreshed = agent.read_bindings()[data["ip"]]["expiresAt"]
        self.assertGreater(refreshed, first_expiry)
        bindings = agent.read_bindings()
        bindings[data["ip"]]["expiresAt"] = time.time() - 1
        agent.save(bindings)
        agent.prune_bindings(None)
        self.assertNotIn(data["ip"], agent.read_bindings())

    def test_prune_continues_after_one_failed_delete(self):
        self.assertEqual(self.request("bind"), 200)
        agent.save({**agent.read_bindings(), "172.16.77.21": {
            "mac": "02:00:00:00:00:21", "userId": "other", "courseId": "course", "classId": "class"}})
        agent.LEASES.write_text("")
        self.nft.side_effect = [subprocess.CalledProcessError(1, "nft"), None]
        agent.prune_bindings(None)
        self.second_prune()
        self.assertEqual(list(agent.read_bindings()), ["172.16.77.20"])


if __name__ == "__main__":
    unittest.main()
