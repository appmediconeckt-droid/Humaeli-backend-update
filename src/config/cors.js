const splitEnvOrigins = (...values) =>
  values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const normalizeOrigin = (origin) => origin?.replace(/\/$/, "");

const isDevTunnelOrigin = (origin) =>
  /^https:\/\/[a-z0-9-]+-\d+\.inc\d+\.devtunnels\.ms$/i.test(origin);

const isPrivateNetworkOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|[a-z0-9-]+\.local):\d+$/i.test(
    origin,
  );

export const configuredOrigins = splitEnvOrigins(
  process.env.CLIENT_URL,
  process.env.TUNNEL_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGINS,
);

export const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "https://www.humaeli.com",
  "https://humaeli.com",
  ...configuredOrigins,
];

export const isAllowedOrigin = (origin) => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return true;

  const exactMatch = allowedOrigins.some(
    (allowedOrigin) => normalizeOrigin(allowedOrigin) === normalized,
  );

  return (
    exactMatch ||
    isDevTunnelOrigin(normalized) ||
    isPrivateNetworkOrigin(normalized)
  );
};

export const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);

    console.warn(`CORS blocked origin: ${origin}`);
    callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],
  optionsSuccessStatus: 204,
};
