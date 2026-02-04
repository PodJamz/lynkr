const { timingSafeEqual } = require("node:crypto");
const config = require("../../config");
const logger = require("../../logger");

/**
 * Remote Access Authentication Middleware (OpenClaw-inspired)
 *
 * Provides authentication for remote access to Lynkr through Cloudflare Tunnel.
 * Security patterns adopted from OpenClaw's gateway auth.
 *
 * Local requests (loopback addresses) bypass authentication.
 * Remote requests require:
 *   - REMOTE_ACCESS_ENABLED=true
 *   - Valid X-Remote-Access-Key header (timing-safe comparison)
 *   - Working directory within allowed directories (if configured)
 */

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Check if IP is a loopback address (OpenClaw pattern)
 * @param {string|undefined} ip - IP address to check
 * @returns {boolean} True if loopback
 */
function isLoopbackAddress(ip) {
  if (!ip) {
    return false;
  }
  if (ip === "127.0.0.1") {
    return true;
  }
  if (ip.startsWith("127.")) {
    return true;
  }
  if (ip === "::1") {
    return true;
  }
  if (ip.startsWith("::ffff:127.")) {
    return true;
  }
  return false;
}

/**
 * Check if address is a trusted proxy
 * @param {string|undefined} addr - Address to check
 * @param {string[]} trustedProxies - List of trusted proxy addresses
 * @returns {boolean} True if trusted
 */
function isTrustedProxy(addr, trustedProxies) {
  if (!addr || !trustedProxies?.length) {
    return false;
  }
  return trustedProxies.some(
    (proxy) => addr === proxy || addr.startsWith(proxy)
  );
}

/**
 * Extract client IP from request, handling proxies
 * @param {Object} req - Express request
 * @returns {string} Client IP address
 */
function resolveClientIp(req) {
  const trustedProxies = config.remoteAccess?.trustedProxies || [];
  const remoteAddr = req.socket?.remoteAddress || req.ip || "";

  // If remote is a trusted proxy, check forwarded headers
  if (isTrustedProxy(remoteAddr, trustedProxies)) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
      // Take the first (original client) IP
      const clientIp = forwardedFor.split(",")[0]?.trim();
      if (clientIp) {
        return clientIp;
      }
    }
    const realIp = req.headers["x-real-ip"];
    if (realIp) {
      return realIp;
    }
  }

  return remoteAddr;
}

/**
 * Check if request is a direct local request (not proxied)
 * @param {Object} req - Express request
 * @returns {boolean} True if local direct request
 */
function isLocalDirectRequest(req) {
  const clientIp = resolveClientIp(req);
  if (!isLoopbackAddress(clientIp)) {
    return false;
  }

  // Check if request has proxy headers indicating it came through a tunnel
  const hasProxyHeaders = Boolean(
    req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.headers["x-forwarded-host"] ||
      req.headers["cf-connecting-ip"] // Cloudflare
  );

  // If has proxy headers, only trust if from trusted proxy
  if (hasProxyHeaders) {
    const remoteAddr = req.socket?.remoteAddress || req.ip || "";
    const trustedProxies = config.remoteAccess?.trustedProxies || [];
    return isTrustedProxy(remoteAddr, trustedProxies);
  }

  return true;
}

/**
 * Remote access authentication middleware
 */
function remoteAccessAuth(req, res, next) {
  const clientIp = resolveClientIp(req);

  // Local direct requests bypass authentication
  if (isLocalDirectRequest(req)) {
    req.isRemoteAccess = false;
    return next();
  }

  // Remote requests require authentication
  if (!config.remoteAccess?.enabled) {
    logger.warn({ ip: clientIp }, "Remote access attempted but disabled");
    return res.status(503).json({
      type: "error",
      error: {
        type: "service_unavailable",
        message: "Remote access is disabled",
      },
    });
  }

  // Check if API key is configured
  const configuredKey = config.remoteAccess.apiKey;
  if (!configuredKey) {
    logger.error("Remote access enabled but no API key configured");
    return res.status(500).json({
      type: "error",
      error: {
        type: "configuration_error",
        message: "Remote access not properly configured",
      },
    });
  }

  // Validate API key with timing-safe comparison
  const providedKey = req.headers["x-remote-access-key"];
  if (!providedKey || !safeEqual(providedKey, configuredKey)) {
    logger.warn(
      { ip: clientIp, hasKey: Boolean(providedKey) },
      "Invalid remote access attempt"
    );
    return res.status(403).json({
      type: "error",
      error: {
        type: "authentication_error",
        message: "Invalid or missing API key",
      },
    });
  }

  // Validate working directory if specified and allowed directories are configured
  const cwd = req.body?.cwd || req.headers["x-workspace-cwd"];
  const allowedDirs = config.remoteAccess.allowedDirectories;

  if (cwd && allowedDirs && allowedDirs.length > 0) {
    const normalizedCwd = cwd.replace(/\/+$/, ""); // Remove trailing slashes
    const allowed = allowedDirs.some((dir) => {
      const normalizedDir = dir.replace(/\/+$/, "");
      return (
        normalizedCwd === normalizedDir ||
        normalizedCwd.startsWith(normalizedDir + "/")
      );
    });

    if (!allowed) {
      logger.warn(
        { ip: clientIp, cwd, allowedDirs },
        "Remote access to disallowed directory"
      );
      return res.status(403).json({
        type: "error",
        error: {
          type: "permission_error",
          message: "Working directory not in allowed list",
        },
      });
    }
  }

  // Mark request as remote for downstream middleware/handlers
  req.isRemoteAccess = true;
  req.remoteIp = clientIp;

  logger.info(
    { ip: clientIp, cwd, sessionId: req.sessionId },
    "Remote access authenticated"
  );

  next();
}

module.exports = {
  remoteAccessAuth,
  isLoopbackAddress,
  isLocalDirectRequest,
  resolveClientIp,
  safeEqual,
};
