# Lynkr - AI Assistant Context

This document provides context for AI assistants (Claude Code, Cursor, etc.) working on this codebase.

## Project Overview

Lynkr is a **self-hosted LLM proxy server** that enables Claude Code, Cursor IDE, and other AI coding tools to work with any LLM provider (Databricks, AWS Bedrock, Ollama, OpenRouter, etc.).

**Key Value Props:**
- Multi-provider support (10+ providers)
- 60-80% cost reduction via token optimization
- 100% local/private option with Ollama/llama.cpp
- Drop-in replacement for Anthropic's backend

## Architecture

```
AI Tools (Claude Code, Cursor, etc.)
         │
         │ Anthropic/OpenAI Format
         ▼
┌─────────────────────────────────────┐
│         Lynkr Proxy (:8081)         │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ API Router  │  │ Tool System  │  │
│  └──────┬──────┘  └──────┬───────┘  │
│         │                │          │
│  ┌──────┴──────┐  ┌──────┴───────┐  │
│  │  Providers  │  │   Sessions   │  │
│  └─────────────┘  └──────────────┘  │
└─────────────────────────────────────┘
         │
         ├──► Databricks / AWS Bedrock
         ├──► Ollama / llama.cpp (local)
         └──► OpenRouter / Azure / OpenAI
```

## Directory Structure

```
src/
├── api/              # Express routes and middleware
│   ├── router.js     # Main API routes (/v1/messages, /v1/models, etc.)
│   └── middleware/   # Auth, session, logging, rate limiting
├── clients/          # LLM provider clients (databricks, ollama, bedrock, etc.)
├── config/           # Configuration management and hot-reload
├── tools/            # Tool implementations (Bash, Read, Write, etc.)
├── sessions/         # Session management and cleanup
├── memory/           # Titans-inspired long-term memory system
├── mcp/              # Model Context Protocol integration
├── observability/    # Prometheus metrics, logging
└── server.js         # Express app setup and startup
```

## Key Files

| File | Purpose |
|------|---------|
| `src/server.js` | Express app creation, middleware chain, startup |
| `src/config/index.js` | All configuration from env vars |
| `src/api/router.js` | API route definitions |
| `src/clients/index.js` | Provider routing logic |
| `src/tools/index.js` | Tool registry |
| `.env` | Environment configuration (copy from `.env.example`) |

## Configuration

All config is via environment variables. Key ones:

```bash
# Provider Selection
MODEL_PROVIDER=ollama|databricks|bedrock|openrouter|azure-openai|...

# Server
PORT=8081
LOG_LEVEL=info|debug|error

# Remote Access (AI James / Cloudflare Tunnel)
REMOTE_ACCESS_ENABLED=true
REMOTE_ACCESS_API_KEY=<secure-key>
REMOTE_ACCESS_ALLOWED_DIRS=/path/to/allowed,/another/path
```

## Remote Access Feature

Lynkr supports authenticated remote access via Cloudflare Tunnel for AI agents.

**Endpoint:** `https://api.jamesspalding.org`

**Authentication:**
- Local requests (127.0.0.1, ::1) bypass auth
- Remote requests require `X-Remote-Access-Key` header
- Timing-safe comparison prevents timing attacks
- Directory restrictions via `REMOTE_ACCESS_ALLOWED_DIRS`

**Headers:**
```
X-Remote-Access-Key: <api-key>
X-Session-Id: <session-uuid>
X-Session-Name: <friendly-name>
X-Workspace-Cwd: /path/to/workspace
```

**Implementation:** `src/api/middleware/remote-access-auth.js`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | POST | Main chat/completion endpoint (Anthropic format) |
| `/v1/models` | GET | List available models |
| `/health/live` | GET | Liveness probe |
| `/health/ready` | GET | Readiness probe |
| `/metrics` | GET | JSON metrics |
| `/metrics/prometheus` | GET | Prometheus format |

## Tool System

Tools are registered in `src/tools/` and execute on the server:

- **Bash** - Command execution
- **Read/Write** - File operations
- **Glob/Grep** - File search
- **WebFetch** - HTTP requests
- **Git** - Version control operations

Tool execution mode controlled by `TOOL_EXECUTION_MODE`:
- `server` - Execute tools server-side (default)
- `passthrough` - Forward to LLM for client execution

## Testing

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:coverage # With coverage report
```

## Common Tasks

**Start development:**
```bash
npm start
```

**Add a new provider:**
1. Create client in `src/clients/<provider>.js`
2. Add to `src/clients/index.js` routing
3. Add config to `src/config/index.js`
4. Document in `documentation/providers.md`

**Add a new tool:**
1. Create in `src/tools/<category>.js`
2. Register in the appropriate `register*Tools()` function
3. Add tests in `test/tools/`

## Code Style

- Node.js ES modules with CommonJS require
- Express for HTTP server
- Pino for structured logging
- Jest for testing
- No TypeScript (plain JavaScript)

## Recent Changes

- **Remote Access Auth**: Added authenticated remote access for AI agents via Cloudflare Tunnel (Feb 2026)
- **Security Hardening**: OpenClaw-inspired timing-safe auth, loopback detection
- **Session Naming**: Support for named sessions via headers
