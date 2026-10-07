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
        exam.HEARTBEATS.clear()

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
