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
        # Every allowlisted name is seeded on the first worker pass after the start.
        self.assertEqual(state["seedDomains"], ["exam.example.edu", "accounts.google.com"])
        self.assertEqual(exam.seed_due(state, 100), ["exam.example.edu", "accounts.google.com"])
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
                                        "lastStation": 100, "failedAt": None, "failId": None,
                                        "reported": False}}}

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

    def test_fail_callback_carries_its_fail_id(self):
        response = type("Response", (), {"status": 200, "__enter__": lambda self: self,
                                          "__exit__": lambda self, *_args: None})()
        with patch.object(exam.urllib.request, "urlopen", return_value=response) as send:
            self.assertTrue(exam.notify_fail({"courseId": "course", "classId": "class", "examId": "exam",
                                              "userId": "student", "failId": "fail-1"},
                                             "secret", "http://callback"))
        self.assertEqual(json.loads(send.call_args.args[0].data)["failId"], "fail-1")

    def test_heartbeats_do_not_write_exam_state(self):
        exam.save(self.state())
        before = exam.EXAM.stat().st_mtime_ns
        exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 140)
        self.assertEqual(exam.EXAM.stat().st_mtime_ns, before)
        exam.monitor({}, 141)
        self.assertEqual(exam.read()["clients"]["student"]["lastHeartbeat"], 140)

    def test_reported_fail_rearms_after_reconnect(self):
        mac = "02:00:00:00:00:20"
        state = self.state()
        exam.connection_status(state, {}, 131)
        first = state["clients"]["student"]["failId"]
        self.assertTrue(first)
        # An unreported fail survives reconnection.
        exam.connection_status(state, {mac: 0}, 140)
        self.assertEqual(state["clients"]["student"]["failId"], first)
        state["clients"]["student"]["reported"] = True
        self.assertFalse(exam.connection_status(state, {mac: 0}, 141)[0]["failed"])
        # A later drop, even after the first was excused, is a new fail with a new ID.
        self.assertFalse(exam.connection_status(state, {}, 171)[0]["failed"])
        self.assertTrue(exam.connection_status(state, {}, 171.5)[0]["failed"])
        self.assertNotEqual(state["clients"]["student"]["failId"], first)

    def test_short_threshold_does_not_rearm_while_absent(self):
        state = self.state(threshold=5)
        exam.connection_status(state, {}, 106)
        state["clients"]["student"]["reported"] = True
        exam.connection_status(state, {}, 107)
        self.assertTrue(state["clients"]["student"]["reported"])

    def test_failed_callback_retries_without_losing_fail_state(self):
        exam.save(self.state())
        pending = exam.monitor({}, 131)
        self.assertEqual(pending, [{"courseId": "course", "classId": "class", "examId": "exam",
                                    "userId": "student", "failId": pending[0]["failId"]}])
        self.assertTrue(pending[0]["failId"])
        # Not marked: the next pass returns the same fail again for another callback.
        self.assertEqual(exam.monitor({}, 132), pending)
        exam.mark_reported("exam", "student", "some-other-fail")
        self.assertEqual(exam.monitor({}, 132.5), pending)
        exam.mark_reported("exam", "student", pending[0]["failId"])
        self.assertEqual(exam.monitor({}, 133), [])
        self.assertTrue(exam.read()["clients"]["student"]["reported"])

    def poll_until(self, state, start, end, last_heard, mac="02:00:00:00:00:20"):
        """Poll every half second; the station was last heard at last_heard."""
        clock = start
        while clock <= end + 1e-9:
            exam.connection_status(state, {mac: clock - last_heard}, clock)
            clock += 0.5
        return clock

    def test_drop_that_ends_between_passes_still_fails(self):
        mac = "02:00:00:00:00:20"
        state = self.state()
        self.poll_until(state, 100, 130, 100)
        self.assertIsNone(state["clients"]["student"]["failedAt"])
        # The monitor lags: the next pass comes 1.2 s later, after the student is back.
        # Absent from 100 to 131.1, so the gap shows the drop.
        self.assertTrue(exam.connection_status(state, {mac: 0.1}, 131.2)[0]["failed"])

    def test_short_drop_that_ends_between_passes_does_not_fail(self):
        mac = "02:00:00:00:00:20"
        state = self.state()
        self.poll_until(state, 100, 129, 100)
        self.assertFalse(exam.connection_status(state, {mac: 0.1}, 129.5)[0]["failed"])

    def test_heartbeat_after_a_long_gap_fails(self):
        state = self.state()
        for clock in (100.5, 110, 120, 130):
            exam.connection_status(state, {}, clock)
        self.assertIsNone(state["clients"]["student"]["failedAt"])
        exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 130.3)
        self.assertTrue(exam.connection_status(state, {}, 130.5)[0]["failed"])

    def test_stalled_monitor_does_not_invent_a_gap(self):
        mac = "02:00:00:00:00:20"
        state = self.state()
        exam.connection_status(state, {mac: 0}, 100)
        # No pass for 40 s: the station may have been present the whole time.
        self.assertFalse(exam.connection_status(state, {mac: 0.2}, 140)[0]["failed"])

    def test_status_reads_without_folding(self):
        state = self.state()
        exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 150)
        before = json.dumps(state, sort_keys=True)
        status = exam.status(state, 140)[0]
        self.assertFalse(status["connected"])
        self.assertEqual(json.dumps(state, sort_keys=True), before)
        self.assertIn(("course", "class", "student"), exam.HEARTBEATS)

    def test_fail_saved_without_an_id_gets_one_and_is_reported(self):
        state = self.state()
        del state["clients"]["student"]["failId"]
        state["clients"]["student"]["failedAt"] = 99
        exam.save(state)
        pending = exam.monitor({}, 101)
        self.assertEqual(len(pending), 1)
        self.assertTrue(pending[0]["failId"])

    def test_idle_exam_devices_are_probed_at_most_every_two_seconds(self):
        mac = "02:00:00:00:00:20"
        state = self.state()
        with patch.object(exam, "_probed", {}):
            self.assertEqual(exam.probe_due(state, {mac: 2.9}, 100), [])
            self.assertEqual(exam.probe_due(state, {mac: 3}, 100), [mac])
            self.assertEqual(exam.probe_due(state, {mac: 4}, 101.5), [])
            self.assertEqual(exam.probe_due(state, {mac: 5}, 102), [mac])
            # Another student's device and unknown station data are never probed.
            self.assertEqual(exam.probe_due(state, {"02:00:00:00:00:99": 9}, 110), [])
            self.assertEqual(exam.probe_due(state, None, 110), [])

    def test_probe_sends_without_blocking(self):
        sent = []
        class Connection:
            def __init__(self, family, _kind):
                self.family = family
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def setblocking(self, flag):
                sent.append(("blocking", flag))
            def sendto(self, data, address):
                sent.append((self.family, address))
        with patch.object(exam.socket, "socket", Connection):
            exam.probe(["172.16.77.20", "fd9b:2f69:8c44::20"])
        self.assertIn((exam.socket.AF_INET, ("172.16.77.20", 9)), sent)
        self.assertIn((exam.socket.AF_INET6, ("fd9b:2f69:8c44::20", 9)), sent)
        self.assertEqual(sent.count(("blocking", False)), 2)

    def test_start_refuses_a_limit_under_ten_seconds(self):
        exam.CLASS_STATE.write_text(json.dumps({"uplink": "eth0", "processes": {"dnsmasq": 123}}))
        with self.assertRaises(ValueError):
            exam.start({"courseId": "course", "classId": "class"}, "exam", ["exam.example.edu"],
                       [{"userId": "student", "mac": "02:00:00:00:00:20"}], 9, now=100)

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
