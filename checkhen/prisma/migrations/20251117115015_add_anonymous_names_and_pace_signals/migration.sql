-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN "anonymousName" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "anonymousName" TEXT;

-- CreateTable
CREATE TABLE "PaceSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaceSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaceSignal_classId_signalType_idx" ON "PaceSignal"("classId", "signalType");

-- AddForeignKey
ALTER TABLE "PaceSignal" ADD CONSTRAINT "PaceSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaceSignal" ADD CONSTRAINT "PaceSignal_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
