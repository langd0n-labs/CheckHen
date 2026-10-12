INSERT INTO "User" ("id", "email", "foodAllergies", "bio")
VALUES ('legacy-student', 'legacy@test.example', 'peanuts', 'Test bio');
INSERT INTO "ClassTemplate" ("id", "name", "color", "duration", "startTime")
VALUES ('legacy-template', 'Old class', 'blue', 60, '09:00');
INSERT INTO "Class" ("id", "name", "duration", "templateId")
VALUES ('legacy-class', 'Old class', 60, 'legacy-template');
INSERT INTO "CheckIn" ("id", "userId", "classId", "anonymousName", "isPresent", "checkOutTime")
VALUES ('legacy-checkin', 'legacy-student', 'legacy-class', 'Swift Panda', false, CURRENT_TIMESTAMP + interval '1 second');
INSERT INTO "HandRaise" ("id", "userId", "classId", "isAcknowledged", "isRated", "hasValue")
VALUES ('legacy-hand', 'legacy-student', 'legacy-class', true, true, true);
INSERT INTO "PaceSignal" ("id", "userId", "classId", "signalType")
VALUES ('legacy-pace', 'legacy-student', 'legacy-class', 'slow_down');
INSERT INTO "ChatMessage" ("id", "userId", "classId", "message", "anonymousName")
VALUES ('legacy-chat', 'legacy-student', 'legacy-class', 'Old question', 'Swift Panda');
