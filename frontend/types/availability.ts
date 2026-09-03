export interface AvailabilityWindow {
  id: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

export interface UnavailablePeriod {
  id: string;
  title: string;
  startDate: string; // ISO datetime
  endDate: string; // ISO datetime
  reason?: string;
}
