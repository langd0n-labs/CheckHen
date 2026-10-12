-- AlterTable
ALTER TABLE "ClassTemplate" ADD COLUMN     "courseId" TEXT NOT NULL DEFAULT 'imported-course';

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "courseId" TEXT NOT NULL DEFAULT 'imported-course';

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterEntry" (
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("courseId","userId")
);

-- CreateTable
CREATE TABLE "ParticipationEvent" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,

    CONSTRAINT "ParticipationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipationEvent_courseId_classId_createdAt_id_idx" ON "ParticipationEvent"("courseId", "classId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationEvent_id_courseId_classId_key" ON "ParticipationEvent"("id", "courseId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_id_courseId_key" ON "Class"("id", "courseId");

-- Preserve all existing sessions in the course approved by the operator.
INSERT INTO "Course" ("id", "name") VALUES ('imported-course', 'Imported course');
ALTER TABLE "Class" ALTER COLUMN "courseId" DROP DEFAULT;
ALTER TABLE "ClassTemplate" ALTER COLUMN "courseId" DROP DEFAULT;
INSERT INTO "RosterEntry" ("courseId", "userId") SELECT 'imported-course', "id" FROM "User";

-- AddForeignKey
ALTER TABLE "ClassTemplate" ADD CONSTRAINT "ClassTemplate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationEvent" ADD CONSTRAINT "ParticipationEvent_classId_courseId_fkey" FOREIGN KEY ("classId", "courseId") REFERENCES "Class"("id", "courseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationEvent" ADD CONSTRAINT "ParticipationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationEvent" ADD CONSTRAINT "ParticipationEvent_supersedesId_courseId_classId_fkey" FOREIGN KEY ("supersedesId", "courseId", "classId") REFERENCES "ParticipationEvent"("id", "courseId", "classId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Import the retained legacy snapshot. Earlier overwritten states cannot be recovered.
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'checkin:' || "id",'imported-course',"classId","userId",'migration','CHECK_IN',
 jsonb_build_object('anonymousName',COALESCE("anonymousName",'Imported ' || left(md5("userId"),12)),'legacyImported',true),"createdAt"
FROM "CheckIn";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'checkout:' || "id",'imported-course',"classId","userId",'migration','CHECK_OUT',
 jsonb_build_object('legacyImported',true,'timestampSource',CASE WHEN "checkOutTime" IS NOT NULL THEN 'checkOutTime' WHEN "updatedAt" IS NOT NULL THEN 'updatedAt' ELSE 'createdAt' END),
 GREATEST(COALESCE("checkOutTime","updatedAt","createdAt"),"createdAt") + interval '1 millisecond'
FROM "CheckIn" WHERE NOT "isPresent";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'hand:' || "id",'imported-course',"classId","userId",'migration','HAND_RAISED',
 jsonb_build_object('legacyImported',true),"createdAt" FROM "HandRaise";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'handack:' || "id",'imported-course',"classId","userId",'migration','HAND_ACKNOWLEDGED',
 jsonb_build_object('handRaiseId','hand:' || "id",'legacyImported',true),
 COALESCE("updatedAt","createdAt") + interval '1 millisecond' FROM "HandRaise" WHERE "isAcknowledged";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'handrate:' || "id",'imported-course',"classId","userId",'migration','HAND_RATED',
 jsonb_build_object('handRaiseId','hand:' || "id",'hasValue',"hasValue",'legacyImported',true),
 COALESCE("updatedAt","createdAt") + interval '2 milliseconds' FROM "HandRaise" WHERE "isRated";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'pace:' || "id",'imported-course',"classId","userId",'migration','PACE_SIGNAL',
 jsonb_build_object('signalType',"signalType",'legacyImported',true),"createdAt" FROM "PaceSignal";
INSERT INTO "ParticipationEvent" ("id","courseId","classId","userId","actorId","kind","payload","createdAt")
SELECT 'chat:' || "id",'imported-course',"classId","userId",'migration','CHAT_MESSAGE',
 jsonb_build_object('message',"message",'anonymousName',COALESCE("anonymousName",'Imported ' || left(md5("userId"),12)),'legacyImported',true),"createdAt" FROM "ChatMessage";

CREATE OR REPLACE FUNCTION checkhen_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Participation events are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER participation_event_no_update_delete
BEFORE UPDATE OR DELETE ON "ParticipationEvent"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_immutable();

CREATE TRIGGER participation_event_no_truncate
BEFORE TRUNCATE ON "ParticipationEvent"
FOR EACH STATEMENT EXECUTE FUNCTION checkhen_event_immutable();

CREATE OR REPLACE FUNCTION checkhen_event_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target "ParticipationEvent";
BEGIN
  IF NEW."supersedesId" IS NOT NULL THEN
    SELECT * INTO target FROM "ParticipationEvent"
      WHERE "id" = NEW."supersedesId" AND "courseId" = NEW."courseId" AND "classId" = NEW."classId";
    IF NOT FOUND OR (target."createdAt", target."id") >= (NEW."createdAt", NEW."id") THEN
      RAISE EXCEPTION 'Supersession must target an earlier event in the same course/session' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.kind NOT IN ('CHECK_IN','CHECK_OUT','HAND_RAISED','HAND_LOWERED',
    'HAND_ACKNOWLEDGED','HAND_RATED','PACE_SIGNAL','PACE_RESET','CHAT_MESSAGE','SESSION_ENDED','UNDO') THEN
    RAISE EXCEPTION 'Unknown participation event kind' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'UNDO' AND NEW."supersedesId" IS NULL THEN
    RAISE EXCEPTION 'Undo requires a target' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER participation_event_order
BEFORE INSERT ON "ParticipationEvent"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_order();

-- Legacy tables are retained as an immutable archive, never used as live state.
CREATE TRIGGER legacy_no_write BEFORE INSERT OR UPDATE OR DELETE ON "CheckIn"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_immutable();
CREATE TRIGGER legacy_no_truncate BEFORE TRUNCATE ON "CheckIn"
FOR EACH STATEMENT EXECUTE FUNCTION checkhen_event_immutable();

-- Legacy tables are retained as an immutable archive, never used as live state.
CREATE TRIGGER legacy_no_write BEFORE INSERT OR UPDATE OR DELETE ON "HandRaise"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_immutable();
CREATE TRIGGER legacy_no_truncate BEFORE TRUNCATE ON "HandRaise"
FOR EACH STATEMENT EXECUTE FUNCTION checkhen_event_immutable();

-- Legacy tables are retained as an immutable archive, never used as live state.
CREATE TRIGGER legacy_no_write BEFORE INSERT OR UPDATE OR DELETE ON "PaceSignal"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_immutable();
CREATE TRIGGER legacy_no_truncate BEFORE TRUNCATE ON "PaceSignal"
FOR EACH STATEMENT EXECUTE FUNCTION checkhen_event_immutable();

-- Legacy tables are retained as an immutable archive, never used as live state.
CREATE TRIGGER legacy_no_write BEFORE INSERT OR UPDATE OR DELETE ON "ChatMessage"
FOR EACH ROW EXECUTE FUNCTION checkhen_event_immutable();
CREATE TRIGGER legacy_no_truncate BEFORE TRUNCATE ON "ChatMessage"
FOR EACH STATEMENT EXECUTE FUNCTION checkhen_event_immutable();
