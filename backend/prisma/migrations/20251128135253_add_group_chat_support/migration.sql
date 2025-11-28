-- AlterTable
ALTER TABLE "room_members" ADD COLUMN     "added_by" TEXT;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "max_members" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "room_key_history" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_key_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_member_key_history" (
    "id" TEXT NOT NULL,
    "room_key_history_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "encrypted_room_key" TEXT NOT NULL,

    CONSTRAINT "room_member_key_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_key_history_room_id_idx" ON "room_key_history"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_key_history_room_id_version_key" ON "room_key_history"("room_id", "version");

-- CreateIndex
CREATE INDEX "room_member_key_history_user_id_idx" ON "room_member_key_history"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_member_key_history_room_key_history_id_user_id_key" ON "room_member_key_history"("room_key_history_id", "user_id");

-- AddForeignKey
ALTER TABLE "room_key_history" ADD CONSTRAINT "room_key_history_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_member_key_history" ADD CONSTRAINT "room_member_key_history_room_key_history_id_fkey" FOREIGN KEY ("room_key_history_id") REFERENCES "room_key_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
