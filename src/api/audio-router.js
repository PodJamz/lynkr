/**
 * Audio Generation Router (ACE-Step Integration)
 *
 * Provides endpoints for music generation via local ACE-Step API:
 * - POST /v1/audio/generate - Create generation task
 * - GET /v1/audio/generate/:taskId/status - Poll for status
 * - GET /v1/audio/generate/:taskId/stream - WebSocket progress stream
 *
 * @module api/audio-router
 */

const express = require("express");
const logger = require("../logger");
const config = require("../config");

const router = express.Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a task in ACE-Step
 */
async function createAceStepTask(request) {
  const endpoint = config.acestep.endpoint;
  const url = `${endpoint}/release_task`;

  logger.info({
    endpoint: url,
    prompt: request.prompt?.slice(0, 100),
    duration: request.duration,
  }, "Creating ACE-Step task");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: request.prompt,
      lyrics: request.lyrics,
      duration: request.duration || 30,
      bpm: request.bpm,
      key: request.key,
      time_signature: request.time_signature || request.timeSignature || "4/4",
      reference_audio: request.reference_audio || request.referenceAudio,
      reference_strength: request.reference_strength || request.referenceStrength || 0.5,
      model: request.model || "acestep-v15-turbo",
      lm_model: request.lm_model || request.lmModel || "acestep-5Hz-lm-1.7B",
      format: request.format || "mp3",
    }),
    signal: AbortSignal.timeout(10000), // 10s timeout for task creation
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ACE-Step API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  
  if (result.code !== 200 || !result.data?.task_id) {
    throw new Error(`Invalid ACE-Step response: ${JSON.stringify(result)}`);
  }

  return result.data.task_id;
}

/**
 * Poll ACE-Step for task result
 */
async function pollAceStepResult(taskId) {
  const endpoint = config.acestep.endpoint;
  const url = `${endpoint}/query_result`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ task_id_list: [taskId] }),
    signal: AbortSignal.timeout(5000), // 5s timeout for polling
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ACE-Step API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  
  if (result.code !== 200) {
    throw new Error(`Invalid ACE-Step response: ${JSON.stringify(result)}`);
  }

  // Result is an array - empty means still processing
  if (!result.data || result.data.length === 0) {
    return null; // Still processing
  }

  // ACE-Step returns { task_id, result (JSON string), status }
  const taskResult = result.data[0];

  // Parse the nested result JSON string
  if (taskResult.result && typeof taskResult.result === 'string') {
    try {
      const parsedResult = JSON.parse(taskResult.result);
      // Return first audio result with task info
      if (Array.isArray(parsedResult) && parsedResult.length > 0) {
        return {
          task_id: taskResult.task_id,
          status: taskResult.status,
          ...parsedResult[0], // First audio result
        };
      }
    } catch (e) {
      logger.error({ error: e.message }, "Failed to parse ACE-Step result JSON");
    }
  }

  return taskResult;
}

/**
 * Format ACE-Step result to Lynkr/AI James OS format
 */
function formatAudioResponse(aceStepResult, taskId) {
  if (!aceStepResult) {
    return null;
  }

  const baseUrl = config.acestep.endpoint;

  // ACE-Step returns: { file, status (1=completed), metas: { bpm, duration, keyscale, timesignature } }
  // Or legacy format: { audio_path, status, metadata }
  const audioPath = aceStepResult.file || aceStepResult.audio_path;
  const metas = aceStepResult.metas || aceStepResult.metadata || {};

  // Construct audio URL - ACE-Step file paths are already URL format
  let audioUrl = null;
  if (audioPath) {
    // If it's already a full path with /v1/audio, use it directly
    audioUrl = audioPath.startsWith('/v1/audio')
      ? `${baseUrl}${audioPath}`
      : `${baseUrl}/v1/audio?path=${encodeURIComponent(audioPath)}`;
  }

  // Status: ACE-Step uses 1 for completed
  const isCompleted = aceStepResult.status === 1 || aceStepResult.status === "completed";

  return {
    id: taskId,
    status: isCompleted ? "completed" : "processing",
    audio_url: audioUrl,
    audioUrl: audioUrl, // Alias for compatibility
    audio_base64: null,
    duration: metas.duration || aceStepResult.duration || 30,
    metadata: {
      bpm: metas.bpm || 120,
      key: metas.keyscale || metas.key || "C major",
      time_signature: metas.timesignature || metas.time_signature || "4/4",
      model: aceStepResult.dit_model || "acestep-v15-turbo",
      lm_model: aceStepResult.lm_model || "acestep-5Hz-lm-1.7B",
    },
    provider: "local-acestep",
  };
}

/**
 * Estimate progress based on duration and elapsed time
 */
function estimateProgress(durationSeconds, elapsedSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return 0.5; // Default 50% if unknown
  
  // Rough estimate: 10s generation takes ~5-10s, 30s takes ~15-30s, etc.
  // Use a conservative estimate (generation time ≈ duration / 2)
  const estimatedGenerationTime = durationSeconds / 2;
  return Math.min(elapsedSeconds / estimatedGenerationTime, 0.95); // Cap at 95% until complete
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /v1/audio/generate
 * Create a new music generation task
 */
router.post("/generate", async (req, res, next) => {
  try {
    // Check if ACE-Step is enabled
    if (!config.acestep?.enabled) {
      return res.status(503).json({
        error: {
          code: "acestep_disabled",
          message: "ACE-Step music generation is not enabled",
        },
      });
    }

    // Validate request
    const { prompt, duration, bpm, key, time_signature, timeSignature, lyrics, model, lm_model, lmModel, format } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: "prompt is required and must be a non-empty string",
        },
      });
    }

    // Validate duration (10-600 seconds)
    const durationValue = duration || 30;
    if (durationValue < 10 || durationValue > 600) {
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: "duration must be between 10 and 600 seconds",
        },
      });
    }

    // Create task in ACE-Step
    const taskId = await createAceStepTask({
      prompt: prompt.trim(),
      lyrics,
      duration: durationValue,
      bpm,
      key,
      time_signature: time_signature || timeSignature,
      model,
      lm_model: lm_model || lmModel,
      format,
    });

    logger.info({ taskId, duration: durationValue }, "ACE-Step task created");

    // Return immediately with task ID (matches AI James OS format)
    res.status(202).json({
      id: taskId,
      status: "queued",
      estimated_duration_seconds: durationValue,
      // For compatibility, also return in AI James OS format
      task_id: taskId, // Alias for id
    });
  } catch (error) {
    logger.error({ error: error.message }, "Failed to create ACE-Step task");
    next(error);
  }
});

/**
 * GET /v1/audio/generate/:taskId/status
 * Poll for task status
 */
router.get("/generate/:taskId/status", async (req, res, next) => {
  try {
    if (!config.acestep?.enabled) {
      return res.status(503).json({
        error: {
          code: "acestep_disabled",
          message: "ACE-Step music generation is not enabled",
        },
      });
    }

    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: "taskId is required",
        },
      });
    }

    // Poll ACE-Step for result
    const aceStepResult = await pollAceStepResult(taskId);

    if (!aceStepResult) {
      // Still processing - estimate progress based on time
      // For now, return "processing" status
      return res.json({
        id: taskId,
        status: "processing",
        progress: 0.5, // Default progress
        audio_url: null,
        metadata: null,
      });
    }

    // Format and return result
    const formatted = formatAudioResponse(aceStepResult, taskId);
    
    if (!formatted) {
      return res.status(500).json({
        error: {
          code: "invalid_response",
          message: "Failed to format ACE-Step response",
        },
      });
    }

    // Calculate progress (1.0 if completed)
    const progress = formatted.status === "completed" ? 1.0 : 0.9;

    // Return in format matching AI James OS expectations
    res.json({
      id: formatted.id,
      status: formatted.status,
      progress,
      audioUrl: formatted.audio_url, // camelCase for AI James OS
      audio_url: formatted.audio_url, // snake_case for compatibility
      audioBase64: formatted.audio_base64,
      duration: formatted.duration,
      metadata: formatted.metadata,
      provider: formatted.provider,
    });
  } catch (error) {
    logger.error({ error: error.message, taskId: req.params.taskId }, "Failed to poll ACE-Step status");
    
    // Check if it's a network error (ACE-Step unavailable)
    if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
      return res.status(503).json({
        error: {
          code: "acestep_unavailable",
          message: "ACE-Step service is unavailable",
        },
      });
    }

    next(error);
  }
});

/**
 * GET /v1/audio/generate/:taskId/stream
 * WebSocket stream for real-time progress updates
 */
router.get("/generate/:taskId/stream", async (req, res, next) => {
  try {
    if (!config.acestep?.enabled) {
      return res.status(503).json({
        error: {
          code: "acestep_disabled",
          message: "ACE-Step music generation is not enabled",
        },
      });
    }

    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: "taskId is required",
        },
      });
    }

    // Check if WebSocket upgrade requested
    const upgrade = req.headers.upgrade;
    if (upgrade !== "websocket") {
      // Fallback to Server-Sent Events (SSE) for compatibility
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const startTime = Date.now();
      const pollInterval = setInterval(async () => {
        try {
          const aceStepResult = await pollAceStepResult(taskId);
          
          if (aceStepResult) {
            const formatted = formatAudioResponse(aceStepResult, taskId);
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = formatted.status === "completed" ? 1.0 : estimateProgress(formatted.duration, elapsed);

            if (formatted.status === "completed") {
              res.write(`data: ${JSON.stringify({
                type: "completed",
                id: formatted.id,
                status: formatted.status,
                audioUrl: formatted.audio_url,
                audio_url: formatted.audio_url,
                duration: formatted.duration,
                metadata: formatted.metadata,
                provider: formatted.provider,
              })}\n\n`);
              clearInterval(pollInterval);
              res.end();
            } else {
              res.write(`data: ${JSON.stringify({
                type: "progress",
                id: formatted.id,
                status: formatted.status,
                progress,
                estimated_seconds_remaining: Math.max(0, formatted.duration - elapsed),
              })}\n\n`);
            }
          } else {
            // Still processing
            const elapsed = (Date.now() - startTime) / 1000;
            res.write(`data: ${JSON.stringify({
              type: "progress",
              status: "processing",
              progress: 0.5,
              estimated_seconds_remaining: 30, // Default estimate
            })}\n\n`);
          }
        } catch (error) {
          logger.error({ error: error.message, taskId }, "Error polling in SSE stream");
          res.write(`data: ${JSON.stringify({
            type: "error",
            error: error.message,
          })}\n\n`);
          clearInterval(pollInterval);
          res.end();
        }
      }, 2000); // Poll every 2 seconds

      // Cleanup on client disconnect
      req.on("close", () => {
        clearInterval(pollInterval);
      });

      return;
    }

    // WebSocket upgrade (requires ws library - implement if needed)
    // For now, return 501 Not Implemented
    return res.status(501).json({
      error: {
        code: "websocket_not_implemented",
        message: "WebSocket streaming not yet implemented. Use SSE endpoint instead.",
      },
    });
  } catch (error) {
    logger.error({ error: error.message, taskId: req.params.taskId }, "Failed to stream ACE-Step progress");
    next(error);
  }
});

module.exports = router;
