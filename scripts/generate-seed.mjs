import { writeFile } from 'node:fs/promises';
import { demoCatalog } from '../src/lib/demo.ts';
const quote = (value) =>
  value === null
    ? 'null'
    : typeof value === 'boolean' || typeof value === 'number'
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`;
let sql =
  '-- DEMONSTRATION DATA ONLY. Stalls, prices and stock photos are illustrative.\n-- Do not apply to production without replacing and verifying the listings.\n';
for (const [table, rows] of [
  ['locations', demoCatalog.locations],
  ['categories', demoCatalog.categories],
  ['stalls', demoCatalog.stalls],
  ['menu_items', demoCatalog.items],
]) {
  for (const original of rows) {
    const row = { ...original, ...(table === 'stalls' ? { is_demo: true } : {}) };
    const keys = Object.keys(row);
    sql += `insert into public.${table} (${keys.join(',')}) values (${keys.map((k) => quote(row[k])).join(',')}) on conflict(id) do nothing;\n`;
  }
}
sql += `\n-- Future demonstration slots in Asia/Manila, refreshed each time the seed is applied.\ninsert into public.pickup_slots(stall_id,start_time,end_time,max_reservations)\nselect s.id, ((now() at time zone 'Asia/Manila')::date + d + t) at time zone 'Asia/Manila', ((now() at time zone 'Asia/Manila')::date + d + t + interval '30 minutes') at time zone 'Asia/Manila',20\nfrom public.stalls s cross join generate_series(0,6) d cross join (values (time '11:00'),(time '11:30'),(time '12:00'),(time '12:30'),(time '13:00'),(time '16:00')) slots(t)\nwhere s.is_demo and ((now() at time zone 'Asia/Manila')::date + d + t) at time zone 'Asia/Manila'>now()\non conflict(stall_id,start_time) do nothing;\n`;
await writeFile('supabase/seed.sql', sql);
