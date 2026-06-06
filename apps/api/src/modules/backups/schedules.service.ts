import type { ScheduleDto, ScheduleInput } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as settingsService from "../settings/settings.service.js";
import * as repo from "./schedules.repository.js";
import * as jobRepo from "./backups.repository.js";
import { nextRunForCron, zonedWallClockToInstant } from "./schedule-time.js";

export async function getSchedule(jobId: string): Promise<ScheduleDto | null> {
  return repo.findByJob(jobId);
}

export async function upsertSchedule(jobId: string, input: ScheduleInput): Promise<ScheduleDto> {
  if (!(await jobRepo.findJobById(jobId))) throw HttpError.notFound("Evento de backup no encontrado");
  const timezone = input.timezone?.trim() || (await settingsService.getGeneral()).timezone;
  const isActive = input.isActive ?? true;
  const now = new Date();

  if (input.mode === "once") {
    if (!input.runAt) throw HttpError.badRequest("Indica la fecha y hora");
    const runAt = zonedWallClockToInstant(input.runAt, timezone);
    return repo.upsert(jobId, {
      mode: "once",
      runAt,
      cron: null,
      timezone,
      isActive,
      nextRunAt: isActive ? runAt : null,
    });
  }

  const cron = input.cron?.trim();
  if (!cron) throw HttpError.badRequest("Indica la expresión de recurrencia");
  return repo.upsert(jobId, {
    mode: "recurring",
    runAt: null,
    cron,
    timezone,
    isActive,
    nextRunAt: isActive ? nextRunForCron(cron, timezone, now) : null,
  });
}

export async function deleteSchedule(jobId: string): Promise<void> {
  await repo.deleteByJob(jobId);
}
