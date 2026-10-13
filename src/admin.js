const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function row(job) {
  const flag = job.status === "needs_human" ? " ⚠ needs you" : "";
  const approve =
    job.status === "booked"
      ? ""
      : `<form method="POST" action="/admin/approve">
           <input type="hidden" name="id" value="${job.id}">
           <button>Approve &amp; confirm</button>
         </form>`;
  return `<tr>
    <td>#${job.id}${flag}</td>
    <td>${esc(job.caller)}</td>
    <td>${esc(job.service)}</td>
    <td>${esc([job.name, job.address].filter(Boolean).join(", "))}</td>
    <td>${esc(job.preferred_time)}</td>
    <td>${esc(job.status)}</td>
    <td>${approve}</td>
  </tr>`;
}

export function renderAdmin(jobs, business) {
  const rows = jobs.map(row).join("\n") || `<tr><td colspan="7">No jobs yet.</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(business.name)} — jobs</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#111}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ddd;padding:.5rem .6rem;text-align:left;vertical-align:top}
  th{background:#f6f6f6}
  button{padding:.35rem .7rem;cursor:pointer}
  tr:nth-child(even){background:#fafafa}
</style></head>
<body>
  <h1>${esc(business.name)} — front desk</h1>
  <p>Jobs captured from text messages. Nothing is confirmed with a caller until you approve it.</p>
  <table>
    <thead><tr><th>Job</th><th>Caller</th><th>Service</th><th>Name / address</th><th>Wants</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}
