-- Demo mode shows only courses its seed created; a course a visitor adds is never the demo.
ALTER TABLE "Course" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;
