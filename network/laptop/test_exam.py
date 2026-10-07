"""Exam allowlist and disconnect evidence tests."""
import json
import struct
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import exam


class ExamTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        for name, filename in (("EXAM", "exam.json"), ("DNS_SERVERS", "exam-servers"),
                               ("CLASS_STATE", "state.json")):
            mocked = patch.object(exam, name, Path(directory.name) / filename)
            mocked.start()
            self.addCleanup(mocked.stop)
        exam.HEARTBEATS.clear()

    def test_domains_reject_invalid_and_deduplicate(self):
        self.assertEqual(exam.validate_domains(["Exam.Example.edu.", "exam.example.edu"]),
                         ["exam.example.edu"])
        for value in ([], ["localhost"], ["a..b"], ["*.example.edu"], ["a.example", 12]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                exam.validate_domains(value)

    def test_policy_restricts_both_families_and_flushes_atomically(self):
        with patch.object(exam.subprocess, "run") as run:
            exam.apply_policy(True, "eth0")
        script = run.call_args.kwargs["input"]
        self.assertEqual(run.call_args.args, (["nft", "-f", "-"],))
        self.assertIn("flush set ip checkhen exam4", script)
        self.assertIn("flush set ip6 checkhen6 exam6", script)
        self.assertIn("@authorized4 ip daddr @exam4", script)
        self.assertIn("@authorized6 ip6 daddr @exam6", script)
        self.assertEqual(script.count("counter drop"), 2)
        with patch.object(exam.subprocess, "run") as run:
            exam.apply_policy(False, "eth0")
        self.assertNotIn("add rule", run.call_args.kwargs["input"])

    def test_seeded_addresses_are_added_without_flushing(self):
        with patch.object(exam.subprocess, "run") as run:
            exam.add_addresses(["93.184.215.14", "2606:2800:220:1:248:1893:25c8:1946"])
        script = run.call_args.kwargs["input"]
        self.assertIn("add element ip checkhen exam4 { 93.184.215.14 }", script)
        self.assertIn("add element ip6 checkhen6 exam6 { 2606:2800:220:1:248:1893:25c8:1946 }", script)
        self.assertNotIn("flush", script)

    def test_idle_sets_flush_at_most_once_a_minute(self):
        with patch.object(exam, "_idle_flushed_at", 0), patch.object(exam.subprocess, "run") as run:
            exam.flush_idle(1000)
            exam.flush_idle(1059)
            exam.flush_idle(1060)
        self.assertEqual(run.call_count, 2)

    def test_start_filters_dns_before_gate_and_seeds_sign_in_domains(self):
        exam.CLASS_STATE.write_text(json.dumps({"uplink": "eth0", "processes": {"dnsmasq": 123}}))
        order = []
        with patch.object(exam, "write_dns", side_effect=lambda domains, _: order.append(("dns", domains))), \
             patch.object(exam, "apply_policy", side_effect=lambda active, _: order.append(("gate", active))), \
             patch.object(exam.time, "sleep"):
            state = exam.start({"courseId": "course", "classId": "class"}, "exam",
                               ["exam.example.edu", "accounts.google.com"],
                               [{"userId": "student", "mac": "02:00:00:00:00:20"}], 30,
                               preauth=["accounts.google.com"], now=100)
        # The DNS filter is in place before the gate, and no address is resolved at start.
        self.assertEqual(order, [("dns", ["exam.example.edu", "accounts.google.com"]), ("gate", True)])
        self.assertEqual(state["seedDomains"], ["accounts.google.com"])
        self.assertEqual(exam.seed_due(state, 100), ["accounts.google.com"])
        self.assertEqual(exam.seed_due(state, 129), [])

    def test_start_failure_releases_dns_and_gate(self):
        exam.CLASS_STATE.write_text(json.dumps({"uplink": "eth0", "processes": {"dnsmasq": 123}}))
        calls = []
        def gate(active, _):
            calls.append(active)
            if active:
                raise subprocess.CalledProcessError(1, "nft")
        with patch.object(exam, "write_dns", side_effect=lambda domains, _: calls.append(domains)), \
             patch.object(exam, "apply_policy", side_effect=gate), patch.object(exam.time, "sleep"), \
             self.assertRaises(subprocess.CalledProcessError):
            exam.start({"courseId": "course", "classId": "class"}, "exam", ["exam.example.edu"],
                       [{"userId": "student", "mac": "02:00:00:00:00:20"}], 30, now=100)
        self.assertEqual(calls, [["exam.example.edu"], True, [], False])
        self.assertIsNone(exam.read())

    def test_dns_query_parses_compressed_answers_and_drops_private_addresses(self):
        sent = {}
        class Connection:
            def __init__(self, *_args): pass
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def settimeout(self, _value): pass
            def sendto(self, packet, address):
                sent["packet"], sent["address"] = packet, address
            def recv(self, _size):
                packet = sent["packet"]
                question = packet[12:]
                answers = (b"\xc0\x0c" + struct.pack("!HHIH", 5, 1, 60, 2) + b"\xc0\x0c" +
                           b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([93, 184, 215, 14]) +
                           b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([10, 0, 0, 1]))
                return packet[:2] + struct.pack("!HHHHH", 0x8180, 1, 3, 0, 0) + question + answers
        with patch.object(exam.socket, "socket", Connection):
            self.assertEqual(exam.query("172.16.77.1", "exam.example.edu", 1), ["93.184.215.14"])
        self.assertEqual(sent["address"], ("172.16.77.1", 53))

    def test_dns_blocks_other_names_and_refreshes(self):
        with patch.object(exam, "os") as os_mock:
            exam.write_dns(["exam.example.edu"], 123)
        self.assertEqual(exam.DNS_SERVERS.read_text(),
                         "server=/#/\nserver=/exam.example.edu/1.1.1.1\nserver=/exam.example.edu/9.9.9.9\n")
        self.assertEqual(exam.DNS_SERVERS.stat().st_mode & 0o777, 0o644)
        os_mock.kill.assert_called_once()

    def state(self, threshold=30):
        return {"courseId": "course", "classId": "class", "examId": "exam",
                "thresholdSeconds": threshold, "domains": ["exam.example.edu"], "refreshedAt": 1e9,
                "clients": {"student": {"mac": "02:00:00:00:00:20", "lastHeartbeat": 100,
                                        "lastStation": 100, "failedAt": None, "reported": False}}}

    def test_disconnect_fails_after_threshold_from_last_station_activity(self):
        mac = "02:00:00:00:00:20"
        # A listed station that has been silent since 100 is not presence.
        state = self.state()
        self.assertFalse(exam.connection_status(state, {mac: 29}, 129)[0]["failed"])
        self.assertTrue(exam.connection_status(state, {mac: 30.5}, 130.5)[0]["failed"])
        # Heard at 131, then gone: 29 seconds passes, 31 seconds fails (brief M5 check 2).
        state = self.state()
        exam.connection_status(state, {mac: 0}, 131)
        self.assertFalse(exam.connection_status(state, {}, 160)[0]["failed"])
        self.assertTrue(exam.connection_status(state, {}, 162)[0]["failed"])

    def test_disconnect_threshold_uses_heartbeats_without_station_data(self):
        state = self.state()
        exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 131)
        self.assertTrue(exam.connection_status(state, {}, 138)[0]["connected"])
        self.assertFalse(exam.connection_status(state, {}, 160)[0]["failed"])
        self.assertTrue(exam.connection_status(state, {}, 161.5)[0]["failed"])

    def test_missing_station_data_records_no_fail(self):
        state = self.state()
        status = exam.connection_status(state, None, 200)[0]
        self.assertFalse(status["failed"])
        self.assertFalse(status["connected"])
        self.assertTrue(exam.connection_status(state, {}, 201)[0]["failed"])

    def test_heartbeats_do_not_write_exam_state(self):
        exam.save(self.state())
        before = exam.EXAM.stat().st_mtime_ns
        exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 140)
        self.assertEqual(exam.EXAM.stat().st_mtime_ns, before)
        exam.monitor({}, 141)
        self.assertEqual(exam.read()["clients"]["student"]["lastHeartbeat"], 140)

    def test_failed_callback_retries_without_losing_fail_state(self):
        exam.save(self.state())
        pending = exam.monitor({}, 131)
        self.assertEqual(pending, [{"courseId": "course", "classId": "class",
                                    "examId": "exam", "userId": "student"}])
        # Not marked: the next pass returns it again for another callback.
        self.assertEqual(exam.monitor({}, 132), pending)
        exam.mark_reported("exam", "student")
        self.assertEqual(exam.monitor({}, 133), [])
        self.assertTrue(exam.read()["clients"]["student"]["reported"])

    def test_ordinary_class_never_touches_the_exam_gate(self):
        # With no exam running, the monitor and a heartbeat return before any nft,
        # DNS, or callback work, so the exam chains stay empty.
        with patch.object(exam.subprocess, "run") as run, patch.object(exam, "os") as os_mock, \
             patch.object(exam, "notify_fail") as notify, \
             patch.object(exam.socket, "getaddrinfo") as resolve:
            self.assertEqual(exam.monitor({"02:00:00:00:00:20"}, 1000), [])
            exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 1000)
        run.assert_not_called()
        os_mock.kill.assert_not_called()
        notify.assert_not_called()
        resolve.assert_not_called()
        self.assertFalse(exam.EXAM.exists())
        self.assertFalse(exam.DNS_SERVERS.exists())


if __name__ == "__main__":
    unittest.main()
