import type { ScheduleDto, ScheduleInput } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as settingsService from "../settings/settings.service.js";
import * as repo from "./schedules.repository.js";
import * as jobRepo from "./backups.repository.js";
import { nextRunForCron, zonedWallClockToInstant } from "./schedule-time.js";

export async function getSchedule(jobId: string): Promise<ScheduleDto | null> {
  return repo.findByTarget({ jobId });
}

export async function upsertSchedule(jobId: string, input: ScheduleInput): Promise<ScheduleDto> {
  if (!(await jobRepo.findJobById(jobId))) throw HttpError.notFound("Evento de backup no encontrado");
  return upsertForTarget({ jobId }, input);
}

export async function deleteSchedule(jobId: string): Promise<void> {
  await repo.deleteByTarget({ jobId });
}

/** Valida la entrada y guarda la programación del evento o grupo, con su próximo disparo. */
export async function upsertForTarget(target: repo.ScheduleTarget, input: ScheduleInput): Promise<ScheduleDto> {
  const timezone = input.timezone?.trim() || (await settingsService.getGeneral()).timezone;
  const isActive = input.isActive ?? true;
  const now = new Date();

  if (input.mode === "once") {
    if (!input.runAt) throw HttpError.badRequest("Indica la fecha y hora");
    const runAt = zonedWallClockToInstant(input.runAt, timezone);
    return repo.upsert(target, {
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
  return repo.upsert(target, {
    mode: "recurring",
    runAt: null,
    cron,
    timezone,
    isActive,
    nextRunAt: isActive ? nextRunForCron(cron, timezone, now) : null,
  });
}
