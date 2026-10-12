-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "checkOutTime" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ChatMessage_classId_idx" ON "ChatMessage"("classId");

-- CreateIndex
CREATE INDEX "CheckIn_classId_isPresent_idx" ON "CheckIn"("classId", "isPresent");

-- CreateIndex
CREATE INDEX "CheckIn_userId_classId_idx" ON "CheckIn"("userId", "classId");

-- CreateIndex
CREATE INDEX "HandRaise_classId_isAcknowledged_idx" ON "HandRaise"("classId", "isAcknowledged");

-- CreateIndex
CREATE INDEX "HandRaise_userId_classId_idx" ON "HandRaise"("userId", "classId");
