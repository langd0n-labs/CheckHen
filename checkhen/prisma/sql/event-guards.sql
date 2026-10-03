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
