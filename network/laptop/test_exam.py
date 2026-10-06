"""Exam allowlist and disconnect evidence tests."""
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

    def test_domains_reject_invalid_and_deduplicate(self):
        self.assertEqual(exam.validate_domains(["Exam.Example.edu.", "exam.example.edu"]),
                         ["exam.example.edu"])
        for value in ([], ["localhost"], ["a..b"], ["*.example.edu"], ["a.example", 12]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                exam.validate_domains(value)

    def test_policy_restricts_both_families_and_flushes_atomically(self):
        with patch.object(exam.subprocess, "run") as run:
            exam.apply_policy(["93.184.215.14"], ["2606:2800:220:1:248:1893:25c8:1946"], True, "eth0")
        script = run.call_args.kwargs["input"]
        self.assertEqual(run.call_args.args, (["nft", "-f", "-"],))
        self.assertIn("flush set ip checkhen exam4", script)
        self.assertIn("flush set ip6 checkhen6 exam6", script)
        self.assertIn("@authorized4 ip daddr @exam4", script)
        self.assertIn("@authorized6 ip6 daddr @exam6", script)
        self.assertEqual(script.count("counter drop"), 2)

    def test_dns_blocks_other_names_and_refreshes(self):
        with patch.object(exam, "os") as os_mock:
            exam.write_dns(["exam.example.edu"], 123)
        self.assertEqual(exam.DNS_SERVERS.read_text(),
                         "server=/#/\nserver=/exam.example.edu/1.1.1.1\nserver=/exam.example.edu/9.9.9.9\n")
        self.assertEqual(exam.DNS_SERVERS.stat().st_mode & 0o777, 0o644)
        os_mock.kill.assert_called_once()

    def test_disconnect_threshold_uses_heartbeat_and_station_evidence(self):
        state = {"thresholdSeconds": 30, "clients": {"student": {
            "mac": "02:00:00:00:00:20", "lastHeartbeat": 100, "lastStation": 100,
            "reported": False}}}
        self.assertFalse(exam.connection_status(state, set(), 129)[0]["failed"])
        self.assertTrue(exam.connection_status(state, set(), 131)[0]["failed"])
        self.assertTrue(exam.connection_status(state, {"02:00:00:00:00:20"}, 132)[0]["failed"])
        state["clients"]["student"].pop("failedAt")
        self.assertTrue(exam.connection_status(state, {"02:00:00:00:00:20"}, 131)[0]["connected"])
        self.assertFalse(exam.connection_status(state, set(), 140)[0]["failed"])
        self.assertFalse(exam.connection_status(state, set(), 165)[0]["failed"])
        self.assertTrue(exam.connection_status(state, set(), 167)[0]["failed"])
        state["clients"]["student"]["lastHeartbeat"] = 139
        self.assertTrue(exam.connection_status(state, set(), 140)[0]["connected"])

    def test_ordinary_class_never_touches_the_exam_gate(self):
        # With no exam running, the monitor and a heartbeat return before any nft,
        # DNS, or callback work, so the exam chains stay empty.
        with patch.object(exam.subprocess, "run") as run, patch.object(exam, "os") as os_mock, \
             patch.object(exam, "notify_fail") as notify, \
             patch.object(exam.socket, "getaddrinfo") as resolve:
            self.assertEqual(exam.monitor({"02:00:00:00:00:20"}, "secret", "http://callback", 1000), [])
            exam.heartbeat({"courseId": "course", "classId": "class"}, "student", 1000)
        run.assert_not_called()
        os_mock.kill.assert_not_called()
        notify.assert_not_called()
        resolve.assert_not_called()
        self.assertFalse(exam.EXAM.exists())
        self.assertFalse(exam.DNS_SERVERS.exists())

    def test_failed_callback_retries_without_losing_fail_state(self):
        state = {"courseId": "course", "classId": "class", "examId": "exam",
                 "domains": ["exam.example.edu"], "refreshedAt": 1000, "thresholdSeconds": 30,
                 "clients": {"student": {"mac": "02:00:00:00:00:20", "lastHeartbeat": 1000,
                                          "lastStation": 1000, "reported": False}}}
        exam.save(state)
        with patch.object(exam, "refresh", side_effect=lambda value, _: value), \
             patch.object(exam, "notify_fail", side_effect=[False, True]) as notify:
            self.assertTrue(exam.monitor(set(), "secret", "http://callback", 1031)[0]["failed"])
            self.assertFalse(exam.read()["clients"]["student"]["reported"])
            exam.monitor(set(), "secret", "http://callback", 1032)
            self.assertTrue(exam.read()["clients"]["student"]["reported"])
            self.assertEqual(notify.call_count, 2)


if __name__ == "__main__":
    unittest.main()
