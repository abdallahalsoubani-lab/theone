/** Clinic-local (Asia/Amman) today as YYYY-MM-DD. */
export function clinicToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "YYYY-MM-DD · 3y 5m" for the prefilled DOB/age line. */
export function dobAgeString(dob: Date, ar: boolean): string {
  const iso = dob.toISOString().slice(0, 10);
  const now = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const age = ar ? `${y} سنة ${m} شهر` : `${y}y ${m}m`;
  return `${iso} · ${age}`;
}
