-- AlterTable
ALTER TABLE "services" ADD COLUMN     "mgrNoticeHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "mgrNoticeIntervalHours" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "mgrNoticeLastSentAt" TIMESTAMPTZ,
ADD COLUMN     "mgrNoticeMode" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "mgrNoticeWeekday" TEXT NOT NULL DEFAULT 'lun';
