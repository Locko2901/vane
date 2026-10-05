import { prisma } from '../db'
import { config } from '../config'

export const UPDATE_CRON_KEY = 'updateCron'
export const UPDATE_CRON_ENV = 'DDNS_UPDATE_CRON'

const MAX_LENGTH = 100
const FORMS = 'Use @every <n>m, @every <n>h or a 5-field cron expression such as */2 * * * *.'

const EVERY_MAX = { m: 153_722_867, h: 2_562_047 }

export type CronCheck = { ok: true; value: string } | { ok: false; error: string }

interface FieldSpec {
  name: string
  min: number
  max: number
  names?: Record<string, number>
}

interface ParsedField {
  values: Set<number>
  star: boolean
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: Object.fromEntries(MONTHS.map((m, i) => [m, i + 1])) },
  { name: 'day-of-week', min: 0, max: 6, names: Object.fromEntries(WEEKDAYS.map((d, i) => [d, i])) },
]

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function validateUpdateCron(raw: string): CronCheck {
  const value = raw.trim().split(/\s+/).join(' ')
  if (value === '') return { ok: false, error: `The update schedule is empty. ${FORMS}` }
  if (value.length > MAX_LENGTH) {
    return { ok: false, error: `The update schedule is longer than ${MAX_LENGTH} characters.` }
  }
  return value.startsWith('@') ? checkDescriptor(value) : checkCron(value)
}

function checkDescriptor(value: string): CronCheck {
  if (['@once', '@disabled', '@nevermore'].includes(value.toLowerCase())) {
    return { ok: false, error: `"${value}" would stop favonia from updating your records. ${FORMS}` }
  }
  const every = /^@every (\d+)([mh])$/.exec(value)
  if (!every) {
    if (value.startsWith('@every ')) {
      return {
        ok: false,
        error: `"${value}" is not supported. Give a whole number of minutes or hours, at least 1 minute: for example @every 1m or @every 2h.`,
      }
    }
    return { ok: false, error: `"${value}" is not supported. ${FORMS}` }
  }
  const count = Number(every[1])
  const unit = every[2] as 'm' | 'h'
  if (count < 1) return { ok: false, error: `"${value}" is shorter than the minimum of 1 minute.` }
  if (count > EVERY_MAX[unit]) return { ok: false, error: `"${value}" is longer than favonia can handle.` }
  return { ok: true, value: `@every ${count}${unit}` }
}

function checkCron(value: string): CronCheck {
  const parts = value.split(' ')
  if (parts.length !== 5) {
    return {
      ok: false,
      error: parts.length === 1
        ? `"${value}" is not a schedule. ${FORMS}`
        : `A cron expression has 5 fields (minute hour day-of-month month day-of-week); "${value}" has ${parts.length}.`,
    }
  }
  const fields: ParsedField[] = []
  for (const [i, part] of parts.entries()) {
    const parsed = parseField(part, FIELDS[i])
    if (typeof parsed === 'string') {
      return { ok: false, error: `Invalid ${FIELDS[i].name} field "${part}" in "${value}": ${parsed}.` }
    }
    fields.push(parsed)
  }
  if (!canFire(fields)) {
    return { ok: false, error: `"${value}" never runs (no month in it has that day), so favonia would never update.` }
  }
  return { ok: true, value }
}

function parseField(field: string, spec: FieldSpec): ParsedField | string {
  const values = new Set<number>()
  let star = false
  for (const item of field.split(',')) {
    const [range, step, ...extra] = item.split('/')
    if (extra.length) return 'too many slashes'

    let stepBy = 1
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1) return `the step "${step}" must be a whole number of at least 1`
      stepBy = Number(step)
    }

    let start: number
    let end: number
    if (range === '*' || range === '?') {
      start = spec.min
      end = spec.max
      star ||= stepBy === 1
    } else {
      const bounds = range.split('-')
      if (bounds.length > 2) return 'too many hyphens'
      const low = parseValue(bounds[0], spec)
      if (low === null) return `"${bounds[0]}" is not a valid value`
      start = low
      if (bounds.length === 2) {
        const high = parseValue(bounds[1], spec)
        if (high === null) return `"${bounds[1]}" is not a valid value`
        end = high
      } else {
        end = step === undefined ? start : spec.max
      }
    }

    if (start < spec.min || end > spec.max) return `values must be between ${spec.min} and ${spec.max}`
    if (start > end) return `the range ${start}-${end} runs backwards`
    for (let v = start; v <= end; v += stepBy) values.add(v)
  }
  return { values, star }
}

function parseValue(text: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  return spec.names?.[text.toLowerCase()] ?? null
}

function canFire([, , dom, month, dow]: ParsedField[]): boolean {
  if (!dow.star) return true
  return [...month.values].some((m) => [...dom.values].some((d) => d <= DAYS_IN_MONTH[m - 1]))
}

export type ScheduleSource = 'environment' | 'setting' | 'default'

export interface UpdateSchedule {
  effective: string | null
  source: ScheduleSource
  setting: string | null
  environment: string | null
  readOnly: boolean
  warnings: string[]
}

export async function getUpdateSchedule(): Promise<UpdateSchedule> {
  const row = await prisma.setting.findUnique({ where: { key: UPDATE_CRON_KEY } })
  const setting = row?.value.trim() ? row.value : null
  const environment = config.ddnsUpdateCron.trim() || null
  const base = { setting, environment, readOnly: false, warnings: [] as string[] }

  if (environment !== null) {
    const check = validateUpdateCron(environment)
    if (check.ok) return { ...base, effective: check.value, source: 'environment', readOnly: true }
    base.warnings.push(`${UPDATE_CRON_ENV} is ignored: ${check.error}`)
  }
  if (setting !== null) {
    const check = validateUpdateCron(setting)
    if (check.ok) return { ...base, effective: check.value, source: 'setting' }
    base.warnings.push(`The saved update schedule is ignored: ${check.error}`)
  }
  return { ...base, effective: null, source: 'default' }
}
