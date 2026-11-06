# SourcingXM platform admin

The platform admin signs in through the existing `/login` page. A successful
login using the configured bootstrap password creates or provisions the
reserved account. The password is read from the backend environment and stored
in PostgreSQL only as a bcrypt hash. The backend requires a bootstrap password
of at least 12 characters.

1. Set `ADMIN_EMAIL=admin@blocktxm.com` and `ADMIN_PASSWORD` in `backend/.env`
   for local development, or in the backend service's secret environment for a
   deployment. `backend/.env.admin.example` shows the variable names.
2. Restart the backend after setting the variables.
3. Open the normal login page and sign in with that email and the password set
   in the backend environment. The login provisions the admin account, then
   creates the normal application session.
4. The admin is redirected to `/admin/resumes`, inside a separate admin-only
   workspace with Candidate Data, Users, and Auto-sync Activity navigation.
   The recruiter workspace navigation is not shown to the admin. Other
   accounts cannot use this panel or its API endpoints.

If this email is already registered, a successful bootstrap login resets its
password to the configured secret and grants its active organization
memberships the `ADMIN` role. This address is reserved for the platform
administrator and must not be used as a regular recruiter account. Do not
commit `.env` or disclose the password. Use a strong, unique secret and HTTPS
before enabling access outside local development.

## Admin panel

- **Resume data:** search candidates and resumes, filter by parse status, view
  available extracted fields, quality score, parse errors, missing fields, and
  open the stored resume. Reparse runs asynchronously against the existing
  parsing pipeline.
- **Users:** search registered users and view organization, role, status, join
  time, and last login.
- **Auto-sync activity:** see recent candidate records ingested from the
  Cloudinary resume sync, including parse status, data quality, and missing
  fields. Summary counts include recent arrivals and failed/low-quality data.
- **Resume recovery:** inspect the read-only backlog, export it as CSV, then
  deliberately start the next eligible stage (20, 100, 300, or remaining).
  Later stages stay locked until the admin reviews at least five sample
  resumes from the completed stage and approves them. Recovery uses the
  Candidate Intelligence parser and writes a durable per-resume run history;
  low-quality, partial, duplicate-identity, or clearly worse parses are not
  automatically indexed.

The panel refreshes database data once per minute and can be refreshed
manually. Reparse changes the existing candidate record; it does not create a
second candidate.

Before enabling Resume recovery in a deployment, apply the
`resume_recovery_ledger` Prisma migration from the `backend` directory with
`npx prisma migrate deploy`. Do not start a recovery stage until the migration
is present in the target database. Running batches are resumed by the backend
after restart; no resumes are processed merely by opening the report.
