# Email login and professional registration

## Email/password login

`POST /api/auth/login` requires `email` and `password`. `role` is optional.
When omitted, the saved user role is used for the session and JWTs. When supplied,
the existing role-mismatch check still applies. Password, active-account, and
single-device session checks remain in place.

## Registration

Send `accountType: "Doctor"` or `accountType: "Consultant"` with the existing
`complete-registration` payload. Case and surrounding whitespace are normalized;
the database stores `doctor` or `consultant`. Doctor accounts use the `doctor`
authorization role; Consultant accounts use the existing `counsellor` role. Signup also accepts `accountRole: "doctor"` or
`role: "doctor"` (and the corresponding `consultant` values) as aliases.
If multiple type fields are supplied, they must agree. The response `role` is `doctor`
for doctors and `counsellor` for consultants; use `user.accountType` to label Doctor/Consultant in the UI. Both require the existing
professional registration details.
Email verification is still required. Existing clients can omit `accountType`
and continue using the previous patient/counsellor registration flow.

Doctor registration generates and saves `user.doctorQrCode`, a PNG data URL
(`data:image/png;base64,...`). Clients can use it directly as an image source.
The QR contains a JSON snapshot of the doctor's ID, name, qualification and
specialization at registration. It does not contain credentials, contact details,
or patient information, and does not certify medical credentials.

Consultants and patients do not receive a QR. Client-supplied QR values are ignored.
Signup and login return the saved fields under `user`; the own-profile and profile
update responses also include `accountType` and `doctorQrCode`.

Existing accounts are not backfilled. The current MySQL storage driver adds the
new schema columns when required on insert. Deploy the updated package lock along
with the code so the `qrcode` dependency is installed.

The QR is a registration snapshot. Profile edits do not regenerate it, and scanning
it displays the encoded details rather than opening a website.

Doctor profile details:
- `PUT /api/auth/doctor-profile/:id` (authenticated owner) or the existing
  `PATCH /api/auth/update/:userId` saves `aadhaarNumber`, `panNumber`,
  `permanentAddress`, and `aboutMe` (`about` is accepted as an alias).
- `GET /api/auth/me` and the update response return those fields for the doctor.
- Aadhaar is a 12-digit string; PAN is normalized to uppercase and format checked.
  `aadharNumber`, `adharNumber`, `aadhaar`, `aadhar`, `adhar`, and `pan` are accepted aliases.
- `permanentAddress` accepts address text or an object with `line1`, `line2`,
  `city`, `state`, `pincode`, and `country`; multipart clients can send JSON text.
- Doctor completion requires these details plus the existing required professional
  profile fields, photo, contact details, date of birth, and certification.
  Completion is recalculated on every profile update and cannot be forced by the client.
- Patient-facing professional lists and public doctor profiles require
  `profileCompleted: true` and `isActive: true`. Public responses exclude Aadhaar,
  PAN, and permanent address. About remains available as `aboutMe`.
- MySQL's existing schema synchronization adds the new model columns on writes.
  Existing doctors should save their profile to recalculate completion.
